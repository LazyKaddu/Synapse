use synapse_protocol::{
    ClientBinaryPacket, ServerBinaryPacket, OPCODE_CLIENT_ACTION, OPCODE_CLIENT_INPUT,
    OPCODE_CLIENT_TELEPORT, OPCODE_SERVER_ENTITY_DESPAWN, OPCODE_SERVER_ENTITY_SPAWN,
    OPCODE_SERVER_NEIGHBOR_MOVEMENT, OPCODE_SERVER_PLAYER_STATE_ACK,
};

#[test]
fn test_client_input_binary_roundtrip() {
    let packet = ClientBinaryPacket::Input {
        seq: 42,
        dx: -1,
        dy: 1,
        sprint: true,
        dt_ms: 16,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 10);
    assert_eq!(encoded[0], OPCODE_CLIENT_INPUT);
    assert_eq!(&encoded[1..5], &42u32.to_le_bytes());
    assert_eq!(encoded[5] as i8, -1);
    assert_eq!(encoded[6] as i8, 1);
    assert_eq!(encoded[7], 0x01); // bit 0 = sprint
    assert_eq!(&encoded[8..10], &16u16.to_le_bytes());

    let decoded = ClientBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_client_input_no_sprint_roundtrip() {
    let packet = ClientBinaryPacket::Input {
        seq: 1000,
        dx: 0,
        dy: -1,
        sprint: false,
        dt_ms: 33,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 10);
    assert_eq!(encoded[7], 0x00);

    let decoded = ClientBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_client_action_binary_roundtrip() {
    let packet = ClientBinaryPacket::Action { action_id: 42 };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 5);
    assert_eq!(encoded[0], OPCODE_CLIENT_ACTION);
    assert_eq!(&encoded[1..5], &42u32.to_le_bytes());

    let decoded = ClientBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_client_teleport_binary_roundtrip() {
    let packet = ClientBinaryPacket::Teleport {
        pos_x: 1250.5,
        pos_y: -3400.25,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 9);
    assert_eq!(encoded[0], OPCODE_CLIENT_TELEPORT);
    assert_eq!(&encoded[1..5], &1250.5f32.to_le_bytes());
    assert_eq!(&encoded[5..9], &(-3400.25f32).to_le_bytes());

    let decoded = ClientBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_server_neighbor_movement_binary_roundtrip() {
    let packet = ServerBinaryPacket::NeighborMovement {
        player_id: 1001,
        pos_x: 500.0,
        pos_y: 600.0,
        vel_x: 120.5,
        vel_y: -60.25,
        server_tick: 999,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 25);
    assert_eq!(encoded[0], OPCODE_SERVER_NEIGHBOR_MOVEMENT);
    assert_eq!(&encoded[1..5], &1001u32.to_le_bytes());
    assert_eq!(&encoded[5..9], &500.0f32.to_le_bytes());
    assert_eq!(&encoded[9..13], &600.0f32.to_le_bytes());
    assert_eq!(&encoded[13..17], &120.5f32.to_le_bytes());
    assert_eq!(&encoded[17..21], &(-60.25f32).to_le_bytes());
    assert_eq!(&encoded[21..25], &999u32.to_le_bytes());

    let decoded = ServerBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_server_entity_spawn_binary_roundtrip() {
    let packet = ServerBinaryPacket::EntitySpawn {
        entity_id: 99,
        entity_type: 3,
        pos_x: 100.0,
        pos_y: 200.0,
        health: 100.0,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 18);
    assert_eq!(encoded[0], OPCODE_SERVER_ENTITY_SPAWN);

    let decoded = ServerBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_server_entity_despawn_binary_roundtrip() {
    let packet = ServerBinaryPacket::EntityDespawn { entity_id: 99 };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 5);
    assert_eq!(encoded[0], OPCODE_SERVER_ENTITY_DESPAWN);

    let decoded = ServerBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_server_player_state_ack_binary_roundtrip() {
    let packet = ServerBinaryPacket::PlayerStateAck {
        last_processed_seq: 12345,
        pos_x: 1024.75,
        pos_y: -512.5,
        vel_x: 240.0,
        vel_y: 0.0,
        server_tick: 888,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 25);
    assert_eq!(encoded[0], OPCODE_SERVER_PLAYER_STATE_ACK);
    assert_eq!(&encoded[1..5], &12345u32.to_le_bytes());
    assert_eq!(&encoded[5..9], &1024.75f32.to_le_bytes());
    assert_eq!(&encoded[9..13], &(-512.5f32).to_le_bytes());
    assert_eq!(&encoded[13..17], &240.0f32.to_le_bytes());
    assert_eq!(&encoded[17..21], &0.0f32.to_le_bytes());
    assert_eq!(&encoded[21..25], &888u32.to_le_bytes());

    let decoded = ServerBinaryPacket::decode(&encoded).expect("decode failed");
    assert_eq!(decoded, packet);
}

#[test]
fn test_client_packet_decode_truncated_error() {
    assert!(ClientBinaryPacket::decode(&[]).is_err());
    assert!(ClientBinaryPacket::decode(&[OPCODE_CLIENT_INPUT, 0x00, 0x00]).is_err());
    assert!(ClientBinaryPacket::decode(&[OPCODE_CLIENT_ACTION, 0x00]).is_err());
    assert!(ClientBinaryPacket::decode(&[OPCODE_CLIENT_TELEPORT, 0x00, 0x00, 0x00]).is_err());
}

#[test]
fn test_client_packet_unknown_opcode() {
    let raw = vec![0xFF, 0x00, 0x00, 0x00, 0x00];
    assert!(ClientBinaryPacket::decode(&raw).is_err());
}

#[test]
fn test_server_packet_decode_truncated_and_unknown() {
    assert!(ServerBinaryPacket::decode(&[]).is_err());
    assert!(ServerBinaryPacket::decode(&[OPCODE_SERVER_NEIGHBOR_MOVEMENT, 0x00]).is_err());
    assert!(ServerBinaryPacket::decode(&[OPCODE_SERVER_ENTITY_SPAWN, 0x00]).is_err());
    assert!(ServerBinaryPacket::decode(&[OPCODE_SERVER_ENTITY_DESPAWN, 0x00]).is_err());
    assert!(ServerBinaryPacket::decode(&[OPCODE_SERVER_PLAYER_STATE_ACK, 0x00]).is_err());
    assert!(ServerBinaryPacket::decode(&[0xFE, 0x00, 0x00]).is_err());
}
