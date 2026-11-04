use synapse_spatial::{
    AreaOfInterest, AudioCuller, ChunkCoord, TerrainGenerator, WorldPos, DEFAULT_CHUNK_SIZE,
};

#[test]
fn test_spatial_engine_full_lifecycle() {
    // 1. Initial player spawn at (23450.0, 18900.0)
    let player_pos = WorldPos::new(23450.0, 18900.0);
    let initial_chunk = player_pos.to_chunk(DEFAULT_CHUNK_SIZE);

    assert_eq!(initial_chunk, ChunkCoord::new(23, 18));

    // 2. Compute 3x3 Area of Interest (AOI)
    let aoi_chunks = AreaOfInterest::get_3x3_grid(initial_chunk);
    assert_eq!(aoi_chunks.len(), 9);
    assert!(aoi_chunks.contains(&ChunkCoord::new(22, 17)));
    assert!(aoi_chunks.contains(&ChunkCoord::new(23, 18)));
    assert!(aoi_chunks.contains(&ChunkCoord::new(24, 19)));

    // 3. Player moves east into chunk (24, 18)
    let new_pos = WorldPos::new(24100.0, 18900.0);
    let new_chunk = new_pos.to_chunk(DEFAULT_CHUNK_SIZE);
    assert_eq!(new_chunk, ChunkCoord::new(24, 18));

    // 4. Compute Grid Diff (3 trailing dropped, 3 new added, 6 retained)
    let diff = AreaOfInterest::calculate_diff(initial_chunk, new_chunk);
    assert_eq!(diff.to_unsubscribe.len(), 3);
    assert_eq!(diff.to_subscribe.len(), 3);
    assert_eq!(diff.retained.len(), 6);

    // Verify trailing chunks are on the west side (x = 22)
    for c in &diff.to_unsubscribe {
        assert_eq!(c.x, 22);
    }
    // Verify newly subscribed chunks are on the east side (x = 25)
    for c in &diff.to_subscribe {
        assert_eq!(c.x, 25);
    }

    // 5. Zero-bandwidth terrain generation
    let terrain = TerrainGenerator::new(133742, 0.005);
    let biome1 = terrain.get_biome_at(player_pos.x as f64, player_pos.y as f64);
    let biome2 = terrain.get_biome_at(player_pos.x as f64, player_pos.y as f64);
    assert_eq!(biome1, biome2, "Terrain evaluation must be deterministic");

    // 6. Proximity Audio Culling (Top 50 with hysteresis)
    let audio_culler = AudioCuller::new(3, 5);
    let mut candidates = Vec::new();
    for i in 1..=10 {
        candidates.push((
            i as u32,
            WorldPos::new(new_pos.x + (i as f32 * 50.0), new_pos.y),
        ));
    }

    // First culling without previous subscriptions -> top 3
    let culled = audio_culler.cull_audio_tracks(&new_pos, &[], candidates.clone());
    assert_eq!(culled, vec![1, 2, 3]);

    // Subsequent culling with candidate 4 already active -> retained in hysteresis window
    let culled_with_prev = audio_culler.cull_audio_tracks(&new_pos, &[4], candidates.clone());
    assert_eq!(culled_with_prev, vec![1, 2, 3, 4]);

    // Candidate 8 is outside hysteresis window (max 5) -> dropped
    let culled_far = audio_culler.cull_audio_tracks(&new_pos, &[8], candidates);
    assert!(!culled_far.contains(&8));
}
