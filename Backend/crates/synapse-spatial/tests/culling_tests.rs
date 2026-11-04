use synapse_spatial::{AudioCuller, WorldPos};

#[test]
fn test_audio_culling_top_n_and_hysteresis() {
    let culler = AudioCuller::new(2, 4);
    let listener = WorldPos::new(0.0, 0.0);

    let candidates = vec![
        (1, WorldPos::new(10.0, 0.0)),  // dist 10 - candidate 1
        (2, WorldPos::new(20.0, 0.0)),  // dist 20 - candidate 2
        (3, WorldPos::new(30.0, 0.0)),  // dist 30 - candidate 3 (in hysteresis zone)
        (4, WorldPos::new(40.0, 0.0)),  // dist 40 - candidate 4 (in hysteresis zone)
        (5, WorldPos::new(100.0, 0.0)), // dist 100 - outside hysteresis zone
    ];

    // Case 1: No previous subscriptions -> selects top 2
    let culled = culler.cull_audio_tracks(&listener, &[], candidates.clone());
    assert_eq!(culled, vec![1, 2]);

    // Case 2: Candidate 3 is already subscribed -> retained due to hysteresis
    let culled_with_prev = culler.cull_audio_tracks(&listener, &[3], candidates.clone());
    assert_eq!(culled_with_prev, vec![1, 2, 3]);

    // Case 3: Candidate 5 is subscribed but exceeds hysteresis window -> dropped
    let culled_far = culler.cull_audio_tracks(&listener, &[5], candidates);
    assert!(!culled_far.contains(&5));
}

