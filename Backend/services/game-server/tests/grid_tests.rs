use game_server::engine::{PlayerSession, SpatialGrid};
use synapse_spatial::{ChunkCoord, WorldPos};
use tokio::sync::mpsc;

#[test]
fn test_spatial_grid_lifecycle_and_transition() {
    let grid = SpatialGrid::new();
    let (tx, _rx) = mpsc::unbounded_channel();

    let initial_pos = WorldPos::new(10500.0, 10500.0);
    let initial_chunk = initial_pos.to_chunk(1000.0);
    assert_eq!(initial_chunk, ChunkCoord::new(10, 10));

    let session = PlayerSession::new(
        4092,
        1,
        1,
        "LazyKaddu".to_string(),
        initial_pos,
        initial_chunk,
        tx,
    );

    // 1. Insert player into hot RAM spatial grid
    grid.insert_player(session);
    assert!(grid.sessions.contains_key(&4092));
    assert!(grid
        .chunk_players
        .get(&initial_chunk)
        .unwrap()
        .contains(&4092));

    // 2. Subscribed to all 9 chunks in initial 3x3 grid
    let subscribers = grid.get_chunk_subscribers(initial_chunk);
    assert!(subscribers.contains(&4092));

    // 3. Movement inside same chunk -> No diff triggered
    let same_chunk_pos = WorldPos::new(10600.0, 10700.0);
    let delta = grid.update_player_position(4092, same_chunk_pos, 1000.0);
    assert!(delta.is_none());

    // 4. Movement across boundary into chunk (11, 10)
    let cross_chunk_pos = WorldPos::new(11200.0, 10700.0);
    let delta = grid.update_player_position(4092, cross_chunk_pos, 1000.0);
    assert!(delta.is_some());
    let d = delta.unwrap();
    assert_eq!(d.to_unsubscribe.len(), 3);
    assert_eq!(d.to_subscribe.len(), 3);

    // Player now registered in new chunk and removed from old chunk
    let new_chunk = ChunkCoord::new(11, 10);
    assert!(grid.chunk_players.get(&new_chunk).unwrap().contains(&4092));
    assert!(!grid
        .chunk_players
        .get(&initial_chunk)
        .unwrap()
        .contains(&4092));

    // 5. Remove player on disconnect
    let removed = grid.remove_player(4092);
    assert!(removed.is_some());
    assert!(!grid.sessions.contains_key(&4092));
    assert!(!grid.chunk_players.get(&new_chunk).unwrap().contains(&4092));
}
