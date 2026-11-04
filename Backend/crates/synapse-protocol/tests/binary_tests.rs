use synapse_protocol::{
    ClientBinaryPacket, ServerBinaryPacket, OPCODE_CLIENT_ACTION, OPCODE_CLIENT_MOVEMENT,
    OPCODE_SERVER_ENTITY_DESPAWN, OPCODE_SERVER_ENTITY_SPAWN, OPCODE_SERVER_NEIGHBOR_MOVEMENT,
};

#[test]
fn test_client_movement_binary_decode() {
    let mut raw = vec![OPCODE_CLIENT_MOVEMENT]; // OpCode 0x01
    raw.extend_from_slice(&1250.5f32.to_le_bytes()); // Pos_X
    raw.extend_from_slice(&3400.25f32.to_le_bytes()); // Pos_Y

    assert_eq!(raw.len(), 9);
    let packet = ClientBinaryPacket::decode(&raw).expect("decode failed");
    match packet {
        ClientBinaryPacket::Movement { pos_x, pos_y } => {
            assert_eq!(pos_x, 1250.5);
            assert_eq!(pos_y, 3400.25);
        }
        _ => panic!("Expected Movement packet"),
    }
}

#[test]
fn test_client_action_binary_decode() {
    let mut raw = vec![OPCODE_CLIENT_ACTION]; // OpCode 0x02
    raw.extend_from_slice(&42u32.to_le_bytes()); // Action_ID

    assert_eq!(raw.len(), 5);
    let packet = ClientBinaryPacket::decode(&raw).expect("decode failed");
    assert_eq!(packet, ClientBinaryPacket::Action { action_id: 42 });
}

#[test]
fn test_server_neighbor_movement_binary_encode() {
    let packet = ServerBinaryPacket::NeighborMovement {
        player_id: 1001,
        pos_x: 500.0,
        pos_y: 600.0,
    };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 13);
    assert_eq!(encoded[0], OPCODE_SERVER_NEIGHBOR_MOVEMENT);
}

#[test]
fn test_server_entity_spawn_binary_encode() {
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
}

#[test]
fn test_server_entity_despawn_binary_encode() {
    let packet = ServerBinaryPacket::EntityDespawn { entity_id: 99 };
    let encoded = packet.encode();
    assert_eq!(encoded.len(), 5);
    assert_eq!(encoded[0], OPCODE_SERVER_ENTITY_DESPAWN);
}

#[test]
fn test_client_packet_decode_truncated_error() {
    let raw = vec![0x01, 0x00, 0x00]; // truncated movement
    assert!(ClientBinaryPacket::decode(&raw).is_err());
}

#[test]
fn test_client_packet_unknown_opcode() {
    let raw = vec![0xFF, 0x00, 0x00, 0x00, 0x00];
    assert!(ClientBinaryPacket::decode(&raw).is_err());
}

