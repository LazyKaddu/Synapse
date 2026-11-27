use synapse_protocol::{ChatMessageDto, SocialMessage};
use synapse_storage::{
    calls_topic, social_topic, spatial_topic, InMemoryPubSubBus, PubSubPublisher,
    SocialPubSubEvent, SpatialPubSubEvent,
};

#[test]
fn test_pubsub_topic_formatting() {
    assert_eq!(
        spatial_topic("eu-west", 1),
        "topic:region:eu-west:shard:1:spatial"
    );
    assert_eq!(social_topic("eu-west"), "topic:region:eu-west:social");
    assert_eq!(calls_topic("us-east"), "topic:region:us-east:calls");
}

#[test]
fn test_spatial_pubsub_event_roundtrip() {
    let move_evt = SpatialPubSubEvent::NeighborMovement {
        origin_pod_id: "pod-a".to_string(),
        player_id: 42,
        chunk_x: -1,
        chunk_y: 3,
        pos_x: -640.5,
        pos_y: 1920.25,
        vel_x: 240.0,
        vel_y: 0.0,
        server_tick: 120,
    };

    assert_eq!(move_evt.origin_pod_id(), "pod-a");
    let json = serde_json::to_string(&move_evt).expect("serialize NeighborMovement");
    let decoded: SpatialPubSubEvent =
        serde_json::from_str(&json).expect("deserialize NeighborMovement");
    assert_eq!(decoded, move_evt);

    let chat_evt = SpatialPubSubEvent::ProximityChat {
        origin_pod_id: "pod-b".to_string(),
        chunk_x: 2,
        chunk_y: -4,
        payload_json: r#"{"type":"CHAT_MSG","channel":"local","sender":"Alice","content":"hi"}"#
            .to_string(),
    };

    assert_eq!(chat_evt.origin_pod_id(), "pod-b");
    let chat_json = serde_json::to_string(&chat_evt).expect("serialize ProximityChat");
    let chat_decoded: SpatialPubSubEvent =
        serde_json::from_str(&chat_json).expect("deserialize ProximityChat");
    assert_eq!(chat_decoded, chat_evt);
}

#[test]
fn test_social_pubsub_event_roundtrip() {
    let dm_evt = SocialPubSubEvent::UserMessage {
        origin_pod_id: "pod-1".to_string(),
        target_user_id: "bob_id".to_string(),
        message: SocialMessage::DirectMsgReceived {
            message: ChatMessageDto {
                id: "msg-1".to_string(),
                message_type: "direct".to_string(),
                sender_id: "alice_id".to_string(),
                sender_name: "Alice".to_string(),
                recipient_id: Some("bob_id".to_string()),
                group_id: None,
                content: "Hello across pods!".to_string(),
                created_at: "2026-11-27T12:00:00Z".to_string(),
            },
        },
    };

    assert_eq!(dm_evt.origin_pod_id(), "pod-1");
    let json = serde_json::to_string(&dm_evt).expect("serialize UserMessage");
    let decoded: SocialPubSubEvent =
        serde_json::from_str(&json).expect("deserialize UserMessage");
    let re_json = serde_json::to_string(&decoded).expect("re-serialize");
    assert_eq!(json, re_json);
}

#[tokio::test]
async fn test_in_memory_pubsub_bus_routes_by_topic() {
    let bus = InMemoryPubSubBus::new();
    let mut rx_spatial = bus.subscribe("topic:region:eu-west:shard:1:spatial");
    let mut rx_social = bus.subscribe("topic:region:eu-west:social");

    bus.publish("topic:region:eu-west:shard:1:spatial", "spatial-payload")
        .await
        .expect("publish spatial");
    bus.publish("topic:region:eu-west:social", "social-payload")
        .await
        .expect("publish social");

    assert_eq!(rx_spatial.recv().await.unwrap(), "spatial-payload");
    assert_eq!(rx_social.recv().await.unwrap(), "social-payload");
    assert!(rx_spatial.try_recv().is_err());
    assert!(rx_social.try_recv().is_err());
}
