use synapse_spatial::{AreaOfInterest, ChunkCoord};

#[test]
fn test_3x3_grid_generation() {
    let center = ChunkCoord::new(10, 20);
    let grid = AreaOfInterest::get_3x3_grid(center);
    assert_eq!(grid.len(), 9);
    assert!(grid.contains(&ChunkCoord::new(9, 19)));
    assert!(grid.contains(&ChunkCoord::new(10, 20)));
    assert!(grid.contains(&ChunkCoord::new(11, 21)));
}

#[test]
fn test_grid_diff_when_moving_east() {
    let old_center = ChunkCoord::new(10, 10);
    let new_center = ChunkCoord::new(11, 10); // moved 1 chunk east (+X)

    let diff = AreaOfInterest::calculate_diff(old_center, new_center);

    // 3 trailing chunks unsubscribed (x = 9, y in [9, 10, 11])
    assert_eq!(diff.to_unsubscribe.len(), 3);
    for c in &diff.to_unsubscribe {
        assert_eq!(c.x, 9);
    }

    // 3 new chunks subscribed (x = 12, y in [9, 10, 11])
    assert_eq!(diff.to_subscribe.len(), 3);
    for c in &diff.to_subscribe {
        assert_eq!(c.x, 12);
    }

    // 6 chunks retained (x in [10, 11], y in [9, 10, 11])
    assert_eq!(diff.retained.len(), 6);
}

#[test]
fn test_grid_diff_when_staying_in_same_chunk() {
    let center = ChunkCoord::new(10, 10);
    let diff = AreaOfInterest::calculate_diff(center, center);

    assert!(diff.to_unsubscribe.is_empty());
    assert!(diff.to_subscribe.is_empty());
    assert_eq!(diff.retained.len(), 9);
}

