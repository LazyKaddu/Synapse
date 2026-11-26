use bytes::{Buf, BufMut, Bytes, BytesMut};
use synapse_common::{Result, SynapseError};

pub const OPCODE_CLIENT_INPUT: u8 = 0x01;
pub const OPCODE_CLIENT_ACTION: u8 = 0x02;
pub const OPCODE_CLIENT_TELEPORT: u8 = 0x03;

pub const OPCODE_SERVER_NEIGHBOR_MOVEMENT: u8 = 0x10;
pub const OPCODE_SERVER_ENTITY_SPAWN: u8 = 0x11;
pub const OPCODE_SERVER_ENTITY_DESPAWN: u8 = 0x12;
pub const OPCODE_SERVER_PLAYER_STATE_ACK: u8 = 0x13;

#[derive(Debug, Clone, PartialEq)]
pub enum ClientBinaryPacket {
    /// OpCode 0x01: 10 Bytes [OpCode (u8)] [Seq (u32 LE)] [dx (i8)] [dy (i8)] [flags (u8, bit 0 = sprint)] [dt_ms (u16 LE)]
    Input {
        seq: u32,
        dx: i8,
        dy: i8,
        sprint: bool,
        dt_ms: u16,
    },
    /// OpCode 0x02: 5 Bytes [OpCode (u8)] [Action_ID (u32 LE)]
    Action { action_id: u32 },
    /// OpCode 0x03: 9 Bytes [OpCode (u8)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)]
    Teleport { pos_x: f32, pos_y: f32 },
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServerBinaryPacket {
    /// OpCode 0x10: 25 Bytes [OpCode (u8)] [Player_ID (u32 LE)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)] [Vel_X (f32 LE)] [Vel_Y (f32 LE)] [Server_Tick (u32 LE)]
    NeighborMovement {
        player_id: u32,
        pos_x: f32,
        pos_y: f32,
        vel_x: f32,
        vel_y: f32,
        server_tick: u32,
    },
    /// OpCode 0x11: 18 Bytes [OpCode (u8)] [Entity_ID (u32 LE)] [Entity_Type (u8)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)] [Health (f32 LE)]
    EntitySpawn {
        entity_id: u32,
        entity_type: u8,
        pos_x: f32,
        pos_y: f32,
        health: f32,
    },
    /// OpCode 0x12: 5 Bytes [OpCode (u8)] [Entity_ID (u32 LE)]
    EntityDespawn { entity_id: u32 },
    /// OpCode 0x13: 25 Bytes [OpCode (u8)] [Last_Processed_Seq (u32 LE)] [Pos_X (f32 LE)] [Pos_Y (f32 LE)] [Vel_X (f32 LE)] [Vel_Y (f32 LE)] [Server_Tick (u32 LE)]
    PlayerStateAck {
        last_processed_seq: u32,
        pos_x: f32,
        pos_y: f32,
        vel_x: f32,
        vel_y: f32,
        server_tick: u32,
    },
}

impl ClientBinaryPacket {
    pub fn encode(&self) -> Bytes {
        match *self {
            ClientBinaryPacket::Input {
                seq,
                dx,
                dy,
                sprint,
                dt_ms,
            } => {
                let mut buf = BytesMut::with_capacity(10);
                buf.put_u8(OPCODE_CLIENT_INPUT);
                buf.put_u32_le(seq);
                buf.put_i8(dx);
                buf.put_i8(dy);
                buf.put_u8(if sprint { 0x01 } else { 0x00 });
                buf.put_u16_le(dt_ms);
                buf.freeze()
            }
            ClientBinaryPacket::Action { action_id } => {
                let mut buf = BytesMut::with_capacity(5);
                buf.put_u8(OPCODE_CLIENT_ACTION);
                buf.put_u32_le(action_id);
                buf.freeze()
            }
            ClientBinaryPacket::Teleport { pos_x, pos_y } => {
                let mut buf = BytesMut::with_capacity(9);
                buf.put_u8(OPCODE_CLIENT_TELEPORT);
                buf.put_f32_le(pos_x);
                buf.put_f32_le(pos_y);
                buf.freeze()
            }
        }
    }

    pub fn decode(mut src: &[u8]) -> Result<Self> {
        if src.is_empty() {
            return Err(SynapseError::Protocol(
                "Empty client binary packet".to_string(),
            ));
        }

        let opcode = src.get_u8();
        match opcode {
            OPCODE_CLIENT_INPUT => {
                if src.remaining() < 9 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid input payload length: expected 9 bytes, got {}",
                        src.remaining()
                    )));
                }
                let seq = src.get_u32_le();
                let dx = src.get_i8();
                let dy = src.get_i8();
                let flags = src.get_u8();
                let dt_ms = src.get_u16_le();
                Ok(ClientBinaryPacket::Input {
                    seq,
                    dx,
                    dy,
                    sprint: (flags & 0x01) != 0,
                    dt_ms,
                })
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
            OPCODE_CLIENT_TELEPORT => {
                if src.remaining() < 8 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid teleport payload length: expected 8 bytes, got {}",
                        src.remaining()
                    )));
                }
                let pos_x = src.get_f32_le();
                let pos_y = src.get_f32_le();
                Ok(ClientBinaryPacket::Teleport { pos_x, pos_y })
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
                vel_x,
                vel_y,
                server_tick,
            } => {
                let mut buf = BytesMut::with_capacity(25);
                buf.put_u8(OPCODE_SERVER_NEIGHBOR_MOVEMENT);
                buf.put_u32_le(player_id);
                buf.put_f32_le(pos_x);
                buf.put_f32_le(pos_y);
                buf.put_f32_le(vel_x);
                buf.put_f32_le(vel_y);
                buf.put_u32_le(server_tick);
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
            ServerBinaryPacket::PlayerStateAck {
                last_processed_seq,
                pos_x,
                pos_y,
                vel_x,
                vel_y,
                server_tick,
            } => {
                let mut buf = BytesMut::with_capacity(25);
                buf.put_u8(OPCODE_SERVER_PLAYER_STATE_ACK);
                buf.put_u32_le(last_processed_seq);
                buf.put_f32_le(pos_x);
                buf.put_f32_le(pos_y);
                buf.put_f32_le(vel_x);
                buf.put_f32_le(vel_y);
                buf.put_u32_le(server_tick);
                buf.freeze()
            }
        }
    }

    pub fn decode(mut src: &[u8]) -> Result<Self> {
        if src.is_empty() {
            return Err(SynapseError::Protocol(
                "Empty server binary packet".to_string(),
            ));
        }

        let opcode = src.get_u8();
        match opcode {
            OPCODE_SERVER_NEIGHBOR_MOVEMENT => {
                if src.remaining() < 24 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid neighbor movement payload length: expected 24 bytes, got {}",
                        src.remaining()
                    )));
                }
                let player_id = src.get_u32_le();
                let pos_x = src.get_f32_le();
                let pos_y = src.get_f32_le();
                let vel_x = src.get_f32_le();
                let vel_y = src.get_f32_le();
                let server_tick = src.get_u32_le();
                Ok(ServerBinaryPacket::NeighborMovement {
                    player_id,
                    pos_x,
                    pos_y,
                    vel_x,
                    vel_y,
                    server_tick,
                })
            }
            OPCODE_SERVER_ENTITY_SPAWN => {
                if src.remaining() < 17 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid entity spawn payload length: expected 17 bytes, got {}",
                        src.remaining()
                    )));
                }
                let entity_id = src.get_u32_le();
                let entity_type = src.get_u8();
                let pos_x = src.get_f32_le();
                let pos_y = src.get_f32_le();
                let health = src.get_f32_le();
                Ok(ServerBinaryPacket::EntitySpawn {
                    entity_id,
                    entity_type,
                    pos_x,
                    pos_y,
                    health,
                })
            }
            OPCODE_SERVER_ENTITY_DESPAWN => {
                if src.remaining() < 4 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid entity despawn payload length: expected 4 bytes, got {}",
                        src.remaining()
                    )));
                }
                let entity_id = src.get_u32_le();
                Ok(ServerBinaryPacket::EntityDespawn { entity_id })
            }
            OPCODE_SERVER_PLAYER_STATE_ACK => {
                if src.remaining() < 24 {
                    return Err(SynapseError::Protocol(format!(
                        "Invalid player state ack payload length: expected 24 bytes, got {}",
                        src.remaining()
                    )));
                }
                let last_processed_seq = src.get_u32_le();
                let pos_x = src.get_f32_le();
                let pos_y = src.get_f32_le();
                let vel_x = src.get_f32_le();
                let vel_y = src.get_f32_le();
                let server_tick = src.get_u32_le();
                Ok(ServerBinaryPacket::PlayerStateAck {
                    last_processed_seq,
                    pos_x,
                    pos_y,
                    vel_x,
                    vel_y,
                    server_tick,
                })
            }
            unknown => Err(SynapseError::Protocol(format!(
                "Unknown server opcode: 0x{:02X}",
                unknown
            ))),
        }
    }
}
