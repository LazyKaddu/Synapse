use chrono::{Duration, Utc};
use dashmap::DashMap;
use std::sync::Arc;

#[test]
fn test_read_after_write_consistency_window_logic() {
    let write_flags = Arc::new(DashMap::new());
    let window = Duration::seconds(4);

    // 1. Account 4092 performs high-stakes trade (Write operation)
    write_flags.insert(4092, Utc::now());

    // 2. Immediate read request arrives -> inside window, forced to Master DB
    let last_write = write_flags.get(&4092).expect("flag should exist");
    let is_inside_window = Utc::now() - *last_write < window;
    assert!(
        is_inside_window,
        "Account should be routed to Master during the consistency window"
    );

    // 3. Stale account write timestamp (e.g. 10s ago) -> outside window, safe for Replica read
    write_flags.insert(9999, Utc::now() - Duration::seconds(10));
    let stale_write = write_flags.get(&9999).expect("flag should exist");
    let is_stale_inside_window = Utc::now() - *stale_write < window;
    assert!(
        !is_stale_inside_window,
        "Account outside write window should be allowed to read from replicas"
    );
}

