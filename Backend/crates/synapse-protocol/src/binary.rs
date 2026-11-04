use bytes::{Buf, BufMut, Bytes, BytesMut};
use synapse_common::{Result, SynapseError};

pub const OPCODE_CLIENT_MOVEMENT: u8 = 0x01;
pub const OPCODE_CLIENT_ACTION: u8 = 0x02;

pub const OPCODE_SERVER_NEIGHBOR_MOVEMENT: u8 = 0x10;
pub const OPCODE_SERVER_ENTITY_SPAWN: u8 = 0x11;
pub const OPCODE_SERVER_ENTITY_DESPAWN: u8 = 0x12;

#[derive(Debug, Clone, PartialEq)]
pub enum ClientBinaryPacket {
    /// OpCode 0x01: 9 Bytes [OpCode (u8)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)]
    Movement { pos_x: f32, pos_y: f32 },
    /// OpCode 0x02: 5 Bytes [OpCode (u8)] [Action_ID (u32 LE)]
    Action { action_id: u32 },
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServerBinaryPacket {
    /// OpCode 0x10: 13 Bytes [OpCode (u8)] [Player_ID (u32 LE)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)]
    NeighborMovement {
        player_id: u32,
        pos_x: f32,
        pos_y: f32,
    },
    /// OpCode 0x11: 21 Bytes [OpCode (u8)] [Entity_ID (u32 LE)] [Entity_Type (u8)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)] [Health (f32 LE)]
    EntitySpawn {
        entity_id: u32,
        entity_type: u8,
        pos_x: f32,
        pos_y: f32,
        health: f32,
    },
    /// OpCode 0x12: 5 Bytes [OpCode (u8)] [Entity_ID (u32 LE)]
    EntityDespawn { entity_id: u32 },
}

impl ClientBinaryPacket {
    pub fn decode(mut src: &[u8]) -> Result<Self> {
        if src.is_empty() {
            return Err(SynapseError::Protocol("Empty binary packet".to_string()));
        }

        let opcode = src.get_u8();
        match opcode {
            OPCODE_CLIENT_MOVEMENT => {
                if src.remaining() < 8 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid movement payload length: expected 8 bytes, got {}",
                        src.remaining()
                    )));
                }
                let pos_x = src.get_f32_le();
                let pos_y = src.get_f32_le();
                Ok(ClientBinaryPacket::Movement { pos_x, pos_y })
            }
            OPCODE_CLIENT_ACTION => {
                if src.remaining() < 4 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid action payload length: expected 4 bytes, got {}",
                        src.remaining()
                    )));
                }
                let action_id = src.get_u32_le();
                Ok(ClientBinaryPacket::Action { action_id })
            }
            unknown => Err(SynapseError::Protocol(format!(
                "Unknown client opcode: 0x{:02X}",
                unknown
            ))),
        }
    }
}

impl ServerBinaryPacket {
    pub fn encode(&self) -> Bytes {
        match *self {
            ServerBinaryPacket::NeighborMovement {
                player_id,
                pos_x,
                pos_y,
            } => {
                let mut buf = BytesMut::with_capacity(13);
                buf.put_u8(OPCODE_SERVER_NEIGHBOR_MOVEMENT);
                buf.put_u32_le(player_id);
                buf.put_f32_le(pos_x);
                buf.put_f32_le(pos_y);
                buf.freeze()
            }
            ServerBinaryPacket::EntitySpawn {
                entity_id,
                entity_type,
                pos_x,
                pos_y,
                health,
            } => {
                let mut buf = BytesMut::with_capacity(18);
                buf.put_u8(OPCODE_SERVER_ENTITY_SPAWN);
                buf.put_u32_le(entity_id);
                buf.put_u8(entity_type);
                buf.put_f32_le(pos_x);
                buf.put_f32_le(pos_y);
                buf.put_f32_le(health);
                buf.freeze()
            }
            ServerBinaryPacket::EntityDespawn { entity_id } => {
                let mut buf = BytesMut::with_capacity(5);
                buf.put_u8(OPCODE_SERVER_ENTITY_DESPAWN);
                buf.put_u32_le(entity_id);
                buf.freeze()
            }
        }
    }
}
