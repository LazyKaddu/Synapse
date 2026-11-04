use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use synapse_common::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryIntent {
    Read,
    Write,
}

pub struct DbRouter {
    master_pool: Pool<Postgres>,
    replica_pools: Vec<Pool<Postgres>>,
    // Maps account/session ID to timestamp when write occurred (Read-After-Write window)
    write_flags: Arc<DashMap<i64, DateTime<Utc>>>,
    read_after_write_window: Duration,
}

impl DbRouter {
    pub fn new(
        master_pool: Pool<Postgres>,
        replica_pools: Vec<Pool<Postgres>>,
        window_secs: i64,
    ) -> Self {
        Self {
            master_pool,
            replica_pools,
            write_flags: Arc::new(DashMap::new()),
            read_after_write_window: Duration::seconds(window_secs),
        }
    }

    /// Tags an account session with a write timestamp.
    /// During the window (3-5s), all Reads for this session are forced to the Master database
    /// to avoid stale replica read lag.
    pub fn flag_write(&self, account_id: i64) {
        self.write_flags.insert(account_id, Utc::now());
    }

    /// Resolves the appropriate database pool given the intent and shard key.
    pub fn get_pool(
        &self,
        intent: QueryIntent,
        account_id: Option<i64>,
        _shard_id: i32,
    ) -> Result<&Pool<Postgres>> {
        match intent {
            QueryIntent::Write => Ok(&self.master_pool),
            QueryIntent::Read => {
                // Check if account has written recently
                if let Some(id) = account_id {
                    if let Some(last_write) = self.write_flags.get(&id) {
                        if Utc::now() - *last_write < self.read_after_write_window {
                            return Ok(&self.master_pool);
                        }
                    }
                }

                // If replicas are configured, route read to replica; otherwise fallback to master
                if !self.replica_pools.is_empty() {
                    // Simple round-robin or first replica
                    Ok(&self.replica_pools[0])
                } else {
                    Ok(&self.master_pool)
                }
            }
        }
    }

    pub fn master(&self) -> &Pool<Postgres> {
        &self.master_pool
    }

    pub fn is_in_write_window(&self, account_id: i64) -> bool {
        if let Some(last_write) = self.write_flags.get(&account_id) {
            Utc::now() - *last_write < self.read_after_write_window
        } else {
            false
        }
    }
}
