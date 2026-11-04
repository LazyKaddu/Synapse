use synapse_protocol::SocialMessage;

#[test]
fn test_voice_join_message_serialization() {
    let msg = SocialMessage::VoiceJoin {
        sfu_url: "wss://sfu.game.com".to_string(),
        token: "jwt_token_123".to_string(),
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"VOICE_JOIN""#));
    assert!(json.contains("jwt_token_123"));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_voice_set_tracks_message_serialization() {
    let msg = SocialMessage::VoiceSetTracks {
        subscribe_to: vec!["trk_10".to_string(), "trk_20".to_string()],
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"VOICE_SET_TRACKS""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_phone_ring_message_serialization() {
    let msg = SocialMessage::PhoneRing {
        caller_id: 8812,
        target_id: 4092,
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"PHONE_RING""#));
    assert!(json.contains(r#""caller_id":8812"#));
    assert!(json.contains(r#""target_id":4092"#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

#[test]
fn test_server_restart_migration_message() {
    let msg = SocialMessage::ServerRestart {
        message: "Server migrating. Requesting new boarding pass...".to_string(),
    };
    let json = serde_json::to_string(&msg).expect("serialize failed");
    assert!(json.contains(r#""type":"SERVER_RESTART""#));

    let deserialized: SocialMessage = serde_json::from_str(&json).expect("deserialize failed");
    assert_eq!(msg, deserialized);
}

