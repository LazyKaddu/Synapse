use game_server::engine::pubsub::{
    handle_social_pubsub_payload, handle_spatial_pubsub_payload, PubSubContext,
};
use game_server::engine::{
    simulate_and_broadcast_tick_with_pubsub, OutgoingMessage, PlayerSession, QueuedInput,
    SpatialGrid,
};
use game_server::social::SocialManager;
use std::sync::Arc;
use std::time::Duration;
use synapse_protocol::{ClientBinaryPacket, ServerBinaryPacket, SocialMessage};
use synapse_spatial::{ChunkCoord, CollisionEngine, WorldNoise, WorldPos};
use synapse_storage::{
    social_topic, spatial_topic, InMemoryChatRepository, InMemoryPubSubBus,
    SpatialPubSubEvent,
};
use tokio::sync::mpsc;

fn make_session(
    character_id: i64,
    pos: WorldPos,
    chunk_size: f32,
) -> (PlayerSession, mpsc::UnboundedReceiver<OutgoingMessage>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let session = PlayerSession::new(
        character_id,
        character_id * 10,
        1,
        format!("Player{}", character_id),
        pos,
        pos.to_chunk(chunk_size),
        tx,
    );
    (session, rx)
}

#[tokio::test]
async fn test_10hz_neighbor_movement_cross_pod_fanout_and_self_echo_filter() {
    let bus = Arc::new(InMemoryPubSubBus::new());
    let topic = spatial_topic("eu-west", 1);
    let mut pod_b_rx = bus.subscribe(&topic);

    let grid_a = Arc::new(SpatialGrid::new());
    let grid_b = Arc::new(SpatialGrid::new());
    let collision = CollisionEngine::new(WorldNoise::new(1337));
    let chunk_size = 1024.0;

    // Player 1 on Pod A, Player 2 on Pod B in the same chunk (0, 0)
    let (mut p1, mut p1_rx) = make_session(1, WorldPos::new(100.0, 100.0), chunk_size);
    p1.enqueue_input(QueuedInput {
        seq: 1,
        dx: 1,
        dy: 0,
        sprint: false,
        dt_ms: 16,
    });
    grid_a.insert_player(p1);

    let (p2, mut p2_rx) = make_session(2, WorldPos::new(200.0, 200.0), chunk_size);
    grid_b.insert_player(p2);

    let ctx_a = PubSubContext {
        publisher: bus.clone(),
        pod_id: "pod-a".to_string(),
        region: "eu-west".to_string(),
        shard_id: 1,
    };

    // Simulate tick with snapshot publish enabled
    simulate_and_broadcast_tick_with_pubsub(
        &grid_a,
        &collision,
        chunk_size,
        6,
        true,
        Some(&ctx_a),
    )
    .await;

    // Player 1 receives PlayerStateAck locally
    match p1_rx.try_recv().expect("p1 ack") {
        OutgoingMessage::Binary(b) => {
            let pkt = ServerBinaryPacket::decode(&b).unwrap();
            assert!(matches!(pkt, ServerBinaryPacket::PlayerStateAck { .. }));
        }
        _ => panic!("Expected binary ack"),
    }

    // Pod B receives published SpatialPubSubEvent
    let published = pod_b_rx.recv().await.expect("pubsub event");

    // Self-echo check: Pod A ignores its own message
    handle_spatial_pubsub_payload("pod-a", &grid_a, &published);
    assert!(p1_rx.try_recv().is_err(), "Pod A must ignore its own echo");

    // Pod B processes event and delivers 0x10 NeighborMovement to Player 2
    handle_spatial_pubsub_payload("pod-b", &grid_b, &published);
    match p2_rx.try_recv().expect("p2 neighbor movement") {
        OutgoingMessage::Binary(b) => {
            let pkt = ServerBinaryPacket::decode(&b).unwrap();
            match pkt {
                ServerBinaryPacket::NeighborMovement {
                    player_id,
                    pos_x,
                    server_tick,
                    ..
                } => {
                    assert_eq!(player_id, 1);
                    assert!(pos_x > 100.0);
                    assert_eq!(server_tick, 6);
                }
                other => panic!("Expected NeighborMovement, got {:?}", other),
            }
        }
        _ => panic!("Expected binary NeighborMovement"),
    }
}

#[tokio::test]
async fn test_proximity_chat_cross_pod_delivery() {
    let grid_b = Arc::new(SpatialGrid::new());
    let chunk_size = 1024.0;

    let (p2, mut p2_rx) = make_session(2, WorldPos::new(150.0, 150.0), chunk_size);
    let (p3_far, mut p3_rx) = make_session(3, WorldPos::new(5000.0, 5000.0), chunk_size);
    grid_b.insert_player(p2);
    grid_b.insert_player(p3_far);

    let chat_json = serde_json::to_string(&SocialMessage::ChatMessage {
        channel: "local".to_string(),
        sender: "Alice".to_string(),
        content: "Hello nearby pod B!".to_string(),
    })
    .unwrap();

    let evt = SpatialPubSubEvent::ProximityChat {
        origin_pod_id: "pod-a".to_string(),
        chunk_x: 0,
        chunk_y: 0,
        payload_json: chat_json.clone(),
    };
    let payload = serde_json::to_string(&evt).unwrap();

    handle_spatial_pubsub_payload("pod-b", &grid_b, &payload);

    // Player 2 in chunk (0,0) receives the chat
    match p2_rx.try_recv().expect("p2 receives chat") {
        OutgoingMessage::Text(txt) => assert_eq!(txt, chat_json),
        _ => panic!("Expected text chat"),
    }

    // Player 3 far away does not
    assert!(p3_rx.try_recv().is_err());
}

#[tokio::test]
async fn test_social_direct_and_group_messaging_across_pods() {
    let bus = Arc::new(InMemoryPubSubBus::new());
    let topic = social_topic("eu-west");
    let mut pod_b_rx = bus.subscribe(&topic);

    let chat_repo = Arc::new(InMemoryChatRepository::new());

    let social_a = Arc::new(SocialManager::with_pubsub(
        chat_repo.clone(),
        "pod-a".to_string(),
        "eu-west".to_string(),
        bus.clone(),
    ));
    let social_b = Arc::new(SocialManager::with_pubsub(
        chat_repo.clone(),
        "pod-b".to_string(),
        "eu-west".to_string(),
        bus.clone(),
    ));

    let (alice_tx, mut alice_rx) = mpsc::unbounded_channel();
    let (bob_tx, mut bob_rx) = mpsc::unbounded_channel();

    // Alice connects to Pod A, Bob connects to Pod B
    social_a
        .on_player_connected("alice_id", 101, "Alice", alice_tx)
        .await;
    social_b
        .on_player_connected("bob_id", 202, "Bob", bob_tx)
        .await;

    // Drain initial sync frames
    let _ = alice_rx.recv().await.unwrap();
    let _ = alice_rx.recv().await.unwrap();
    let _ = bob_rx.recv().await.unwrap();
    let _ = bob_rx.recv().await.unwrap();

    // Alice sends a Direct Message to Bob (who is on Pod B)
    social_a
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::DirectMsgSend {
                recipient_id: "bob_id".to_string(),
                content: "Hey Bob from Pod A!".to_string(),
            },
        )
        .await
        .unwrap();

    // Pod B receives the routed social event from Redis Pub/Sub
    let dm_payload = pod_b_rx.recv().await.expect("routed DM event");
    handle_social_pubsub_payload("pod-a", &social_a, &dm_payload); // ignored self-echo
    handle_social_pubsub_payload("pod-b", &social_b, &dm_payload); // delivered to Bob

    let bob_msg = bob_rx.try_recv().expect("Bob receives DM across pods");
    match bob_msg {
        OutgoingMessage::Text(txt) => {
            assert!(txt.contains("DIRECT_MSG_RECEIVED"));
            assert!(txt.contains("Hey Bob from Pod A!"));
        }
        _ => panic!("Expected text DM"),
    }

    // Alice creates a group with Bob and sends a group message
    social_a
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::GroupCreate {
                name: "CrossPodSquad".to_string(),
                initial_members: vec!["bob_id".to_string()],
            },
        )
        .await
        .unwrap();

    let grp_created_payload = pod_b_rx.recv().await.expect("GroupCreated event");
    handle_social_pubsub_payload("pod-b", &social_b, &grp_created_payload);
    let bob_grp = bob_rx.try_recv().expect("Bob receives GroupCreated");
    let group_id = match bob_grp {
        OutgoingMessage::Text(txt) => {
            let parsed: SocialMessage = serde_json::from_str(&txt).unwrap();
            match parsed {
                SocialMessage::GroupCreated { group } => group.id,
                other => panic!("Expected GroupCreated, got {:?}", other),
            }
        }
        _ => panic!("Expected text GroupCreated"),
    };

    social_a
        .handle_social_message(
            "alice_id",
            "Alice",
            SocialMessage::GroupMsgSend {
                group_id,
                content: "Squad up across pods!".to_string(),
            },
        )
        .await
        .unwrap();

    let grp_msg_payload = pod_b_rx.recv().await.expect("GroupMsg event");
    handle_social_pubsub_payload("pod-b", &social_b, &grp_msg_payload);
    match bob_rx.try_recv().expect("Bob receives GroupMsg") {
        OutgoingMessage::Text(txt) => {
            assert!(txt.contains("GROUP_MSG_RECEIVED"));
            assert!(txt.contains("Squad up across pods!"));
        }
        _ => panic!("Expected text GroupMsg"),
    }
}

#[test]
fn test_remote_players_included_in_nearby_candidates_and_pruned() {
    let grid = SpatialGrid::new();
    let chunk = ChunkCoord::new(0, 0);

    grid.upsert_remote_player(999, WorldPos::new(300.0, 400.0), chunk);
    let candidates = grid.get_nearby_candidates(chunk);
    assert!(candidates.iter().any(|(id, _)| *id == 999));

    // Pruning with zero max_age removes stale remote entries
    std::thread::sleep(Duration::from_millis(5));
    grid.prune_stale_remote_players(Duration::from_millis(1));
    let candidates_after = grid.get_nearby_candidates(chunk);
    assert!(!candidates_after.iter().any(|(id, _)| *id == 999));

    // Keep unused import check clean
    let _ = std::mem::size_of::<ClientBinaryPacket>();
}

