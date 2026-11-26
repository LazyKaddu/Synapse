use synapse_protocol::{
    CharacterDto, ClientBinaryPacket, LoginRequest, LoginResponse, ServerBinaryPacket,
    SocialMessage, WorldJoinRequest, WorldJoinResponse, OPCODE_CLIENT_ACTION, OPCODE_CLIENT_INPUT,
    OPCODE_CLIENT_TELEPORT, OPCODE_SERVER_ENTITY_DESPAWN, OPCODE_SERVER_ENTITY_SPAWN,
    OPCODE_SERVER_NEIGHBOR_MOVEMENT, OPCODE_SERVER_PLAYER_STATE_ACK,
};

#[test]
fn test_binary_and_json_protocols_end_to_end() {
    // 1. Client input packet: OpCode 0x01 (10 bytes)
    let client_input = ClientBinaryPacket::Input {
        seq: 7,
        dx: 1,
        dy: -1,
        sprint: true,
        dt_ms: 16,
    };
    let raw_client_input = client_input.encode();
    assert_eq!(raw_client_input.len(), 10);
    assert_eq!(raw_client_input[0], OPCODE_CLIENT_INPUT);

    let parsed_input = ClientBinaryPacket::decode(&raw_client_input).expect("decode failed");
    assert_eq!(parsed_input, client_input);

    // 2. Client action packet: OpCode 0x02 (5 bytes)
    let mut raw_client_action = vec![OPCODE_CLIENT_ACTION];
    raw_client_action.extend_from_slice(&777u32.to_le_bytes());
    assert_eq!(raw_client_action.len(), 5);

    let parsed_action = ClientBinaryPacket::decode(&raw_client_action).expect("decode failed");
    assert_eq!(parsed_action, ClientBinaryPacket::Action { action_id: 777 });

    // 3. Client teleport packet: OpCode 0x03 (9 bytes)
    let client_teleport = ClientBinaryPacket::Teleport {
        pos_x: 1024.5,
        pos_y: 2048.25,
    };
    let raw_teleport = client_teleport.encode();
    assert_eq!(raw_teleport.len(), 9);
    assert_eq!(raw_teleport[0], OPCODE_CLIENT_TELEPORT);
    assert_eq!(
        ClientBinaryPacket::decode(&raw_teleport).expect("decode failed"),
        client_teleport
    );

    // 4. Server downstream neighbor movement packet: OpCode 0x10 (25 bytes)
    let neighbor_packet = ServerBinaryPacket::NeighborMovement {
        player_id: 4092,
        pos_x: 1024.5,
        pos_y: 2048.25,
        vel_x: 240.0,
        vel_y: 0.0,
        server_tick: 105,
    };
    let encoded_neighbor = neighbor_packet.encode();
    assert_eq!(encoded_neighbor.len(), 25);
    assert_eq!(encoded_neighbor[0], OPCODE_SERVER_NEIGHBOR_MOVEMENT);
    assert_eq!(
        ServerBinaryPacket::decode(&encoded_neighbor).expect("decode failed"),
        neighbor_packet
    );

    // 5. Server entity spawn packet: OpCode 0x11 (18 bytes)
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
    assert_eq!(
        ServerBinaryPacket::decode(&encoded_spawn).expect("decode failed"),
        spawn_packet
    );

    // 6. Server entity despawn packet: OpCode 0x12 (5 bytes)
    let despawn_packet = ServerBinaryPacket::EntityDespawn { entity_id: 88 };
    let encoded_despawn = despawn_packet.encode();
    assert_eq!(encoded_despawn.len(), 5);
    assert_eq!(encoded_despawn[0], OPCODE_SERVER_ENTITY_DESPAWN);
    assert_eq!(
        ServerBinaryPacket::decode(&encoded_despawn).expect("decode failed"),
        despawn_packet
    );

    // 7. Server player state ack packet: OpCode 0x13 (25 bytes)
    let ack_packet = ServerBinaryPacket::PlayerStateAck {
        last_processed_seq: 7,
        pos_x: 1024.5,
        pos_y: 2048.25,
        vel_x: 339.41,
        vel_y: -339.41,
        server_tick: 105,
    };
    let encoded_ack = ack_packet.encode();
    assert_eq!(encoded_ack.len(), 25);
    assert_eq!(encoded_ack[0], OPCODE_SERVER_PLAYER_STATE_ACK);
    assert_eq!(
        ServerBinaryPacket::decode(&encoded_ack).expect("decode failed"),
        ack_packet
    );

    // 8. JSON Social Plane: LiveKit Voice Join & Track Subscription
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

    // 9. JSON Social Plane: Cross-Region Telephony Signaling
    let phone_ring = SocialMessage::PhoneRing {
        caller_id: 8812,
        target_id: 4092,
    };
    let json_phone = serde_json::to_string(&phone_ring).unwrap();
    assert!(json_phone.contains(r#""type":"PHONE_RING""#));
    assert!(json_phone.contains(r#""caller_id":8812"#));
    assert!(json_phone.contains(r#""target_id":4092"#));

    // 10. REST API DTOs (Control Plane)
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
