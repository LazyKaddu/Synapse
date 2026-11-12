use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use sqlx::{Pool, Postgres};
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Weak};
use synapse_common::Result;
use tracing::{debug, warn};

/// Default upper bound for tracked per-account write watermarks so memory
/// stays strictly bounded even under sustained high-cardinality traffic.
pub const DEFAULT_MAX_WRITE_FLAGS: usize = 10_000;

/// Number of write flag insertions between amortized inline expiration sweeps.
const PRUNE_CHECK_INTERVAL: usize = 256;

/// PostgreSQL Write-Ahead Log (WAL) Log Sequence Number (`HI/LO` 64-bit offset).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PgLsn(u64);

impl PgLsn {
    /// Constructs a `PgLsn` directly from a 64-bit byte offset.
    pub const fn from_raw(raw: u64) -> Self {
        Self(raw)
    }

    /// Returns the underlying 64-bit WAL byte offset.
    pub const fn as_u64(self) -> u64 {
        self.0
    }

    /// Parses a PostgreSQL WAL LSN string such as `"0/16B3748"` or `"1A/00000040"`.
    pub fn parse(input: &str) -> std::result::Result<Self, String> {
        let trimmed = input.trim();
        let (hi_str, lo_str) = trimmed
            .split_once('/')
            .ok_or_else(|| format!("Invalid PgLsn format '{}': expected 'HI/LO'", trimmed))?;

        if hi_str.is_empty() || lo_str.is_empty() {
            return Err(format!(
                "Invalid PgLsn format '{}': empty hex segment",
                trimmed
            ));
        }

        let hi = u32::from_str_radix(hi_str, 16)
            .map_err(|e| format!("Invalid PgLsn high segment '{}': {}", hi_str, e))?;
        let lo = u32::from_str_radix(lo_str, 16)
            .map_err(|e| format!("Invalid PgLsn low segment '{}': {}", lo_str, e))?;

        Ok(Self(((hi as u64) << 32) | (lo as u64)))
    }
}

impl fmt::Display for PgLsn {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hi = (self.0 >> 32) as u32;
        let lo = (self.0 & 0xFFFF_FFFF) as u32;
        write!(f, "{:X}/{:X}", hi, lo)
    }
}

/// Consistency level required for a database read query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReadConsistency {
    /// Always route to the primary writer pool for strict linearizability.
    /// Immune to arbitrary replica replication lag.
    Strong,
    /// Guarantee read-your-writes for the caller's `account_id`:
    /// - If a WAL LSN was recorded at write completion, verify that a read replica's
    ///   `pg_last_wal_replay_lsn()` has reached or exceeded it before routing to that replica.
    /// - Otherwise (lagging replica, missing LSN, or synchronous lookup inside the window),
    ///   fail closed to the primary writer pool.
    #[default]
    Session,
    /// Allow routing to any available read replica regardless of recent writes.
    Eventual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryIntent {
    Read(ReadConsistency),
    Write,
}

impl QueryIntent {
    pub const READ_STRONG: Self = Self::Read(ReadConsistency::Strong);
    pub const READ_SESSION: Self = Self::Read(ReadConsistency::Session);
    pub const READ_EVENTUAL: Self = Self::Read(ReadConsistency::Eventual);
}

/// Recorded completion state for an account's most recent write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteWatermark {
    pub recorded_at: DateTime<Utc>,
    pub wal_lsn: Option<PgLsn>,
}

/// Pure routing target chosen by [`decide_read_target`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoolSelection {
    Master,
    Replica(usize),
}

/// Bounded TTL store tracking per-account write completion timestamps and WAL LSNs.
///
/// Expired entries are evicted lazily on lookup, periodically via amortized write sweeps
/// (and optional background interval cleanup), and strictly capped at `max_entries`.
#[derive(Debug)]
pub struct WriteTracker {
    entries: DashMap<i64, WriteWatermark>,
    ttl: Duration,
    max_entries: usize,
    ops_since_prune: AtomicUsize,
}

impl WriteTracker {
    pub fn new(ttl: Duration, max_entries: usize) -> Self {
        let clamped_ttl = if ttl < Duration::zero() {
            Duration::zero()
        } else {
            ttl
        };

        Self {
            entries: DashMap::new(),
            ttl: clamped_ttl,
            max_entries: max_entries.max(1),
            ops_since_prune: AtomicUsize::new(0),
        }
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    pub fn max_entries(&self) -> usize {
        self.max_entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Records or updates a write watermark for `account_id`, performing amortized
    /// expiration sweeps and bounded capacity eviction so memory never grows unbounded.
    pub fn record(&self, account_id: i64, now: DateTime<Utc>, wal_lsn: Option<PgLsn>) {
        if self.ttl == Duration::zero() {
            return;
        }

        let op_count = self.ops_since_prune.fetch_add(1, Ordering::Relaxed) + 1;
        if op_count >= PRUNE_CHECK_INTERVAL || self.entries.len() >= self.max_entries {
            self.ops_since_prune.store(0, Ordering::Relaxed);
            self.prune_expired_at(now);
        }

        // If the cache is still full with non-expired entries, evict oldest entries first.
        if !self.entries.contains_key(&account_id) && self.entries.len() >= self.max_entries {
            self.evict_oldest_to_fit(self.max_entries.saturating_sub(1));
        }

        self.entries
            .entry(account_id)
            .and_modify(|existing| {
                if now > existing.recorded_at {
                    existing.recorded_at = now;
                }
                existing.wal_lsn = match (existing.wal_lsn, wal_lsn) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (None, Some(b)) => Some(b),
                    (existing_lsn, None) => existing_lsn,
                };
            })
            .or_insert(WriteWatermark {
                recorded_at: now,
                wal_lsn,
            });
    }

    /// Returns the active watermark if present and unexpired; lazily removes stale entries.
    pub fn get_active(&self, account_id: i64, now: DateTime<Utc>) -> Option<WriteWatermark> {
        let watermark = *self.entries.get(&account_id)?;

        if now - watermark.recorded_at >= self.ttl {
            // Only remove if no newer write replaced the entry since we read it.
            self.entries
                .remove_if(&account_id, |_, current| current.recorded_at == watermark.recorded_at);
            return None;
        }

        Some(watermark)
    }

    /// Removes the watermark once a replica is confirmed to have replayed up to `replayed_lsn`,
    /// preserving any newer watermark written concurrently with a higher LSN.
    pub fn clear_if_caught_up(&self, account_id: i64, replayed_lsn: PgLsn) -> bool {
        self.entries
            .remove_if(&account_id, |_, current| match current.wal_lsn {
                Some(target_lsn) => replayed_lsn >= target_lsn,
                None => false,
            })
            .is_some()
    }

    /// Removes all expired entries as of `now` and returns the number removed.
    pub fn prune_expired_at(&self, now: DateTime<Utc>) -> usize {
        let mut removed = 0usize;
        self.entries.retain(|_, watermark| {
            let keep = now - watermark.recorded_at < self.ttl;
            if !keep {
                removed += 1;
            }
            keep
        });
        removed
    }

    fn evict_oldest_to_fit(&self, target_len: usize) {
        if self.entries.len() <= target_len {
            return;
        }

        let overflow = self.entries.len() - target_len;
        let mut oldest: Vec<(i64, DateTime<Utc>)> = self
            .entries
            .iter()
            .map(|entry| (*entry.key(), entry.value().recorded_at))
            .collect();
        oldest.sort_by_key(|(_, ts)| *ts);

        for (key, recorded_at) in oldest.into_iter().take(overflow) {
            self.entries
                .remove_if(&key, |_, current| current.recorded_at == recorded_at);
        }
    }
}

/// Pure routing decision function for read queries.
///
/// Separating decision logic from live `PgPool` network calls keeps replica-lag,
/// LSN watermark comparison, and consistency guarantees directly testable.
pub fn decide_read_target(
    consistency: ReadConsistency,
    account_id: Option<i64>,
    tracker: &WriteTracker,
    replica_count: usize,
    next_replica_idx: usize,
    replica_lsn: Option<PgLsn>,
    now: DateTime<Utc>,
) -> PoolSelection {
    if consistency == ReadConsistency::Strong || replica_count == 0 {
        return PoolSelection::Master;
    }

    let replica_idx = next_replica_idx % replica_count;

    if consistency == ReadConsistency::Eventual {
        return PoolSelection::Replica(replica_idx);
    }

    // ReadConsistency::Session
    let Some(id) = account_id else {
        return PoolSelection::Replica(replica_idx);
    };

    let Some(watermark) = tracker.get_active(id, now) else {
        return PoolSelection::Replica(replica_idx);
    };

    match (watermark.wal_lsn, replica_lsn) {
        // Replica explicitly proved via WAL replay LSN that it contains this write.
        (Some(target_lsn), Some(replayed_lsn)) if replayed_lsn >= target_lsn => {
            PoolSelection::Replica(replica_idx)
        }
        // Fail closed to primary when LSN is missing, unverified, or replica is still lagging.
        _ => PoolSelection::Master,
    }
}

/// Single-cluster read/write PostgreSQL connection router.
///
/// Note: Sharding is intentionally omitted while Synapse runs on a single PostgreSQL/Aurora cluster.
/// When horizontal cluster sharding is introduced later, cluster-to-shard mapping belongs here.
pub struct DbRouter {
    master_pool: Pool<Postgres>,
    replica_pools: Vec<Pool<Postgres>>,
    write_tracker: Arc<WriteTracker>,
    replica_cursor: AtomicUsize,
}

impl DbRouter {
    pub fn new(
        master_pool: Pool<Postgres>,
        replica_pools: Vec<Pool<Postgres>>,
        window_secs: i64,
    ) -> Self {
        Self::with_capacity(
            master_pool,
            replica_pools,
            window_secs,
            DEFAULT_MAX_WRITE_FLAGS,
        )
    }

    pub fn with_capacity(
        master_pool: Pool<Postgres>,
        replica_pools: Vec<Pool<Postgres>>,
        window_secs: i64,
        max_write_flags: usize,
    ) -> Self {
        Self {
            master_pool,
            replica_pools,
            write_tracker: Arc::new(WriteTracker::new(
                Duration::seconds(window_secs),
                max_write_flags,
            )),
            replica_cursor: AtomicUsize::new(0),
        }
    }

    /// Spawns a periodic expiration cleanup loop bound via `Weak<DbRouter>` so it exits
    /// automatically once all strong references to the router are dropped.
    pub fn spawn_cleanup_task(
        self: &Arc<Self>,
        interval: std::time::Duration,
    ) -> tokio::task::JoinHandle<()> {
        let weak_router: Weak<Self> = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            // Skip immediate first tick; only sweep periodically going forward.
            ticker.tick().await;
            loop {
                ticker.tick().await;
                let Some(router) = weak_router.upgrade() else {
                    break;
                };
                let evicted = router.prune_expired_flags();
                if evicted > 0 {
                    debug!(evicted, "Pruned expired write watermarks from DbRouter");
                }
            }
        })
    }

    /// Records write completion by querying the primary's current WAL LSN (`pg_current_wal_lsn()`).
    ///
    /// If the WAL LSN query fails or is unsupported, still records a conservative `wal_lsn: None`
    /// watermark so `ReadConsistency::Session` fails closed to the primary within the TTL.
    pub async fn complete_write(&self, account_id: i64) {
        let lsn_result = sqlx::query_scalar::<_, String>("SELECT pg_current_wal_lsn()::text")
            .fetch_one(&self.master_pool)
            .await;

        let wal_lsn = match lsn_result {
            Ok(raw_lsn) => match PgLsn::parse(&raw_lsn) {
                Ok(parsed) => Some(parsed),
                Err(err) => {
                    warn!(account_id, error = %err, "Failed to parse pg_current_wal_lsn()");
                    None
                }
            },
            Err(err) => {
                warn!(account_id, error = %err, "Failed to fetch pg_current_wal_lsn() after write");
                None
            }
        };

        self.write_tracker.record(account_id, Utc::now(), wal_lsn);
    }

    /// Synchronous write marker without a WAL LSN (causes `Session` reads to fail closed
    /// to primary until the TTL expires).
    pub fn flag_write(&self, account_id: i64) {
        self.write_tracker.record(account_id, Utc::now(), None);
    }

    /// Records an explicit WAL LSN write watermark for `account_id`.
    pub fn flag_write_at_lsn(&self, account_id: i64, lsn: PgLsn) {
        self.write_tracker
            .record(account_id, Utc::now(), Some(lsn));
    }

    /// Resolves the appropriate database pool asynchronously, using PostgreSQL WAL replay LSN
    /// verification (`pg_last_wal_replay_lsn()`) when evaluating `ReadConsistency::Session`.
    pub async fn resolve_pool(
        &self,
        intent: QueryIntent,
        account_id: Option<i64>,
    ) -> Result<&Pool<Postgres>> {
        let consistency = match intent {
            QueryIntent::Write => return Ok(&self.master_pool),
            QueryIntent::Read(consistency) => consistency,
        };

        if consistency == ReadConsistency::Strong || self.replica_pools.is_empty() {
            return Ok(&self.master_pool);
        }

        let candidate_idx =
            self.replica_cursor.fetch_add(1, Ordering::Relaxed) % self.replica_pools.len();
        let now = Utc::now();

        let replica_lsn = match consistency {
            ReadConsistency::Session => {
                if let Some(id) = account_id {
                    if let Some(wm) = self.write_tracker.get_active(id, now) {
                        if wm.wal_lsn.is_some() {
                            self.query_replica_replay_lsn(&self.replica_pools[candidate_idx])
                                .await
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            ReadConsistency::Strong | ReadConsistency::Eventual => None,
        };

        match decide_read_target(
            consistency,
            account_id,
            &self.write_tracker,
            self.replica_pools.len(),
            candidate_idx,
            replica_lsn,
            now,
        ) {
            PoolSelection::Master => Ok(&self.master_pool),
            PoolSelection::Replica(idx) => {
                if let (Some(id), Some(rep_lsn)) = (account_id, replica_lsn) {
                    self.write_tracker.clear_if_caught_up(id, rep_lsn);
                }
                Ok(&self.replica_pools[idx])
            }
        }
    }

    /// Synchronous pool resolution for callers outside an async context.
    ///
    /// Because WAL replay positions cannot be probed synchronously, `ReadConsistency::Session`
    /// conservatively routes to primary whenever an active write watermark exists.
    pub fn get_pool(&self, intent: QueryIntent, account_id: Option<i64>) -> Result<&Pool<Postgres>> {
        let consistency = match intent {
            QueryIntent::Write => return Ok(&self.master_pool),
            QueryIntent::Read(consistency) => consistency,
        };

        let next_idx = if self.replica_pools.is_empty() {
            0
        } else {
            self.replica_cursor.fetch_add(1, Ordering::Relaxed) % self.replica_pools.len()
        };

        match decide_read_target(
            consistency,
            account_id,
            &self.write_tracker,
            self.replica_pools.len(),
            next_idx,
            None,
            Utc::now(),
        ) {
            PoolSelection::Master => Ok(&self.master_pool),
            PoolSelection::Replica(idx) => Ok(&self.replica_pools[idx]),
        }
    }

    async fn query_replica_replay_lsn(&self, replica_pool: &Pool<Postgres>) -> Option<PgLsn> {
        let raw = sqlx::query_scalar::<_, Option<String>>(
            "SELECT pg_last_wal_replay_lsn()::text",
        )
        .fetch_one(replica_pool)
        .await
        .ok()??;

        PgLsn::parse(&raw).ok()
    }

    pub fn master(&self) -> &Pool<Postgres> {
        &self.master_pool
    }

    pub fn prune_expired_flags(&self) -> usize {
        self.write_tracker.prune_expired_at(Utc::now())
    }

    pub fn active_write_flag_count(&self) -> usize {
        self.write_tracker.len()
    }

    pub fn is_in_write_window(&self, account_id: i64) -> bool {
        self.write_tracker
            .get_active(account_id, Utc::now())
            .is_some()
    }
}
