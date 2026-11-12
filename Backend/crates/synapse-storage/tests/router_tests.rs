use chrono::{Duration, Utc};
use synapse_storage::router::{decide_read_target, PoolSelection};
use synapse_storage::{PgLsn, ReadConsistency, WriteTracker};

#[test]
fn test_pg_lsn_parse_display_and_ordering() {
    let low = PgLsn::parse("0/16B3748").expect("valid low LSN");
    let mid = PgLsn::parse("0/2000000").expect("valid mid LSN");
    let high = PgLsn::parse("1/00000010").expect("valid high segment LSN");

    assert!(low < mid);
    assert!(mid < high);
    assert_eq!(low.to_string(), "0/16B3748");
    assert_eq!(high.to_string(), "1/10");

    assert!(PgLsn::parse("not-an-lsn").is_err());
    assert!(PgLsn::parse("0/").is_err());
    assert!(PgLsn::parse("/10").is_err());
    assert!(PgLsn::parse("0/ZZ").is_err());
}

#[test]
fn test_write_tracker_lazy_expiration_and_periodic_prune() {
    let tracker = WriteTracker::new(Duration::seconds(5), 100);
    let t0 = Utc::now();
    let lsn = PgLsn::parse("0/1000").unwrap();

    tracker.record(101, t0, Some(lsn));
    tracker.record(102, t0 + Duration::seconds(4), Some(lsn));
    assert_eq!(tracker.len(), 2);

    // At t0 + 6s: account 101 has expired and is lazily evicted; account 102 remains active.
    let expired = tracker.get_active(101, t0 + Duration::seconds(6));
    assert!(expired.is_none(), "expired watermark must return None");
    assert!(
        tracker.get_active(102, t0 + Duration::seconds(6)).is_some(),
        "unexpired watermark should remain active"
    );
    assert_eq!(tracker.len(), 1, "lazy eviction should remove stale entry");

    // At t0 + 10s: periodic prune sweeps remaining expired entry.
    let pruned = tracker.prune_expired_at(t0 + Duration::seconds(10));
    assert_eq!(pruned, 1);
    assert!(tracker.is_empty());
}

#[test]
fn test_write_tracker_bounded_capacity_evicts_oldest() {
    let max_entries = 8;
    let tracker = WriteTracker::new(Duration::seconds(60), max_entries);
    let t0 = Utc::now();

    for i in 0..32i64 {
        tracker.record(i, t0 + Duration::milliseconds(i * 10), None);
        assert!(
            tracker.len() <= max_entries,
            "tracker length {} exceeded max_entries {}",
            tracker.len(),
            max_entries
        );
    }

    assert_eq!(tracker.len(), max_entries);
    // Most recent accounts should be retained while the earliest were evicted.
    assert!(tracker.get_active(0, t0 + Duration::seconds(1)).is_none());
    assert!(tracker.get_active(31, t0 + Duration::seconds(1)).is_some());
}

#[test]
fn test_clear_if_caught_up_respects_lsn_monotonicity() {
    let tracker = WriteTracker::new(Duration::seconds(10), 100);
    let t0 = Utc::now();
    let lsn_v1 = PgLsn::parse("0/1000").unwrap();
    let lsn_v2 = PgLsn::parse("0/2000").unwrap();

    tracker.record(42, t0, Some(lsn_v2));

    // Older replica LSN must NOT clear newer write watermark.
    assert!(!tracker.clear_if_caught_up(42, lsn_v1));
    assert_eq!(tracker.len(), 1);

    // Caught-up replica LSN >= write watermark clears it.
    assert!(tracker.clear_if_caught_up(42, lsn_v2));
    assert!(tracker.is_empty());
}

#[test]
fn test_decide_read_target_consistency_levels_and_lsn_checks() {
    let tracker = WriteTracker::new(Duration::seconds(5), 100);
    let t0 = Utc::now();
    let write_lsn = PgLsn::parse("0/2000").unwrap();
    let lagging_rep_lsn = PgLsn::parse("0/1500").unwrap();
    let caught_up_rep_lsn = PgLsn::parse("0/2500").unwrap();

    tracker.record(4092, t0, Some(write_lsn));

    // Strong consistency ALWAYS routes to master, regardless of replica state.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Strong,
            Some(4092),
            &tracker,
            2,
            1,
            Some(caught_up_rep_lsn),
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Master
    );

    // Eventual consistency uses replicas via round-robin index even during active write window.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Eventual,
            Some(4092),
            &tracker,
            2,
            1,
            None,
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Replica(1)
    );

    // Session consistency routes to master when replica WAL LSN is behind write LSN.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Session,
            Some(4092),
            &tracker,
            2,
            0,
            Some(lagging_rep_lsn),
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Master
    );

    // Session consistency also fails closed to master when replica LSN is unavailable.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Session,
            Some(4092),
            &tracker,
            2,
            0,
            None,
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Master
    );

    // Session consistency routes to replica once WAL replay LSN meets/exceeds write LSN.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Session,
            Some(4092),
            &tracker,
            2,
            1,
            Some(caught_up_rep_lsn),
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Replica(1)
    );

    // Sync write flag without WAL LSN fails closed to master during window.
    tracker.record(777, t0, None);
    assert_eq!(
        decide_read_target(
            ReadConsistency::Session,
            Some(777),
            &tracker,
            2,
            0,
            Some(caught_up_rep_lsn),
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Master
    );

    // No replicas configured -> always routes to master.
    assert_eq!(
        decide_read_target(
            ReadConsistency::Eventual,
            None,
            &tracker,
            0,
            0,
            None,
            t0 + Duration::seconds(1),
        ),
        PoolSelection::Master
    );
}
