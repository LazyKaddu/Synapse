use synapse_protocol::{
    CharacterDto, ClientBinaryPacket, LoginRequest, LoginResponse, ServerBinaryPacket,
    SocialMessage, WorldJoinRequest, WorldJoinResponse, OPCODE_CLIENT_ACTION,
    OPCODE_CLIENT_MOVEMENT, OPCODE_SERVER_ENTITY_DESPAWN, OPCODE_SERVER_ENTITY_SPAWN,
    OPCODE_SERVER_NEIGHBOR_MOVEMENT,
};

#[test]
fn test_binary_and_json_protocols_end_to_end() {
    // 1. Client movement packet: OpCode 0x01 (9 bytes)
    let mut raw_client_move = vec![OPCODE_CLIENT_MOVEMENT];
    raw_client_move.extend_from_slice(&1024.5f32.to_le_bytes());
    raw_client_move.extend_from_slice(&2048.25f32.to_le_bytes());
    assert_eq!(raw_client_move.len(), 9);

    let parsed_move = ClientBinaryPacket::decode(&raw_client_move).expect("decode failed");
    assert_eq!(
        parsed_move,
        ClientBinaryPacket::Movement {
            pos_x: 1024.5,
            pos_y: 2048.25,
        }
    );

    // 2. Client action packet: OpCode 0x02 (5 bytes)
    let mut raw_client_action = vec![OPCODE_CLIENT_ACTION];
    raw_client_action.extend_from_slice(&777u32.to_le_bytes());
    assert_eq!(raw_client_action.len(), 5);

    let parsed_action = ClientBinaryPacket::decode(&raw_client_action).expect("decode failed");
    assert_eq!(parsed_action, ClientBinaryPacket::Action { action_id: 777 });

    // 3. Server downstream neighbor movement packet: OpCode 0x10 (13 bytes)
    let neighbor_packet = ServerBinaryPacket::NeighborMovement {
        player_id: 4092,
        pos_x: 1024.5,
        pos_y: 2048.25,
    };
    let encoded_neighbor = neighbor_packet.encode();
    assert_eq!(encoded_neighbor.len(), 13);
    assert_eq!(encoded_neighbor[0], OPCODE_SERVER_NEIGHBOR_MOVEMENT);

    // 4. Server entity spawn packet: OpCode 0x11 (21 bytes)
    let spawn_packet = ServerBinaryPacket::EntitySpawn {
        entity_id: 88,
        entity_type: 2,
        pos_x: 500.0,
        pos_y: 600.0,
        health: 100.0,
    };
    let encoded_spawn = spawn_packet.encode();
    assert_eq!(encoded_spawn.len(), 18);
    assert_eq!(encoded_spawn[0], OPCODE_SERVER_ENTITY_SPAWN);

    // 5. Server entity despawn packet: OpCode 0x12 (5 bytes)
    let despawn_packet = ServerBinaryPacket::EntityDespawn { entity_id: 88 };
    let encoded_despawn = despawn_packet.encode();
    assert_eq!(encoded_despawn.len(), 5);
    assert_eq!(encoded_despawn[0], OPCODE_SERVER_ENTITY_DESPAWN);

    // 6. JSON Social Plane: LiveKit Voice Join & Track Subscription
    let voice_join = SocialMessage::VoiceJoin {
        sfu_url: "wss://sfu.game.com".to_string(),
        token: "livekit_jwt_token_sample".to_string(),
    };
    let json_voice = serde_json::to_string(&voice_join).unwrap();
    assert!(json_voice.contains(r#""type":"VOICE_JOIN""#));
    assert!(json_voice.contains("livekit_jwt_token_sample"));

    let voice_tracks = SocialMessage::VoiceSetTracks {
        subscribe_to: vec!["trk_1".to_string(), "trk_2".to_string()],
    };
    let json_tracks = serde_json::to_string(&voice_tracks).unwrap();
    assert!(json_tracks.contains(r#""type":"VOICE_SET_TRACKS""#));

    // 7. JSON Social Plane: Cross-Region Telephony Signaling
    let phone_ring = SocialMessage::PhoneRing {
        caller_id: 8812,
        target_id: 4092,
    };
    let json_phone = serde_json::to_string(&phone_ring).unwrap();
    assert!(json_phone.contains(r#""type":"PHONE_RING""#));
    assert!(json_phone.contains(r#""caller_id":8812"#));
    assert!(json_phone.contains(r#""target_id":4092"#));

    // 8. REST API DTOs (Control Plane)
    let login_req = LoginRequest {
        username: "LazyKaddu".to_string(),
        password: "secure_password".to_string(),
    };
    let login_resp = LoginResponse {
        token: "auth_jwt_token".to_string(),
        account_id: 4092,
    };
    let char_dto = CharacterDto {
        character_id: 1,
        display_name: "LazyKaddu".to_string(),
        chunk_x: 23,
        chunk_y: 25,
        pos_x: 23500.5,
        pos_y: 25100.2,
    };
    let join_req = WorldJoinRequest {
        character_id: 1,
        target_region: "eu-west".to_string(),
    };
    let join_resp = WorldJoinResponse {
        ws_url: "wss://eu-west.game.com/socket".to_string(),
        ticket: "boarding_pass_ticket".to_string(),
    };

    assert_eq!(login_req.username, "LazyKaddu");
    assert_eq!(login_resp.account_id, 4092);
    assert_eq!(char_dto.chunk_x, 23);
    assert_eq!(join_req.target_region, "eu-west");
    assert_eq!(join_resp.ws_url, "wss://eu-west.game.com/socket");
}
