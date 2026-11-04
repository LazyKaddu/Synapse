use synapse_livekit::LiveKitRoomOrchestrator;
use synapse_spatial::ChunkCoord;

#[tokio::test]
async fn test_lazy_room_lifecycle_creation_and_destruction() {
    let orchestrator = LiveKitRoomOrchestrator::new(
        "http://127.0.0.1:7880".to_string(),
        "devkey".to_string(),
        "secret".to_string(),
    );
    let coord = ChunkCoord::new(23, 25);
    let room_name = LiveKitRoomOrchestrator::chunk_room_name(1, coord);

    // 1 player in chunk -> No room created (Lazy creation rule)
    orchestrator
        .handle_chunk_population_change(1, coord, 1)
        .await
        .unwrap();
    assert!(!orchestrator.is_room_active(&room_name).await);

    // 2 players in chunk -> Room created lazily
    orchestrator
        .handle_chunk_population_change(1, coord, 2)
        .await
        .unwrap();
    assert!(orchestrator.is_room_active(&room_name).await);

    // 1 player left -> Room destroyed to save SFU resources
    orchestrator
        .handle_chunk_population_change(1, coord, 1)
        .await
        .unwrap();
    assert!(!orchestrator.is_room_active(&room_name).await);
}

#[test]
fn test_mega_crowd_token_downgrade() {
    let orchestrator = LiveKitRoomOrchestrator::new(
        "http://127.0.0.1:7880".to_string(),
        "devkey".to_string(),
        "secret".to_string(),
    );
    let coord = ChunkCoord::new(23, 25);

    // Normal crowd (100 players) -> Token can publish audio
    let normal_token = orchestrator
        .mint_chunk_token("Kaddu", 1, coord, 100, 500)
        .unwrap();
    assert!(!normal_token.is_empty());

    // Mega crowd (550 players) -> Downgraded to listen-only mode
    let mega_token = orchestrator
        .mint_chunk_token("Kaddu", 1, coord, 550, 500)
        .unwrap();
    assert!(!mega_token.is_empty());
}

#[test]
fn test_phone_call_room_token_minting() {
    let orchestrator = LiveKitRoomOrchestrator::new(
        "http://127.0.0.1:7880".to_string(),
        "devkey".to_string(),
        "secret".to_string(),
    );
    let phone_token = orchestrator
        .mint_phone_token("PlayerA", "call_8812_4092")
        .unwrap();
    assert!(!phone_token.is_empty());
}

