// Protocol opcodes and message definitions matching Synapse Rust backend wire contract

export const BinaryOpCode = {
  // Client -> Server (Upstream)
  CLIENT_INPUT: 0x01,    // 10 Bytes: [u8 opcode][u32 seq][i8 dx][i8 dy][u8 flags][u16 dt_ms]
  CLIENT_ACTION: 0x02,   // 5 Bytes:  [u8 opcode][u32 action_id]
  CLIENT_TELEPORT: 0x03, // 9 Bytes:  [u8 opcode][f32 pos_x][f32 pos_y]

  // Server -> Client (Downstream)
  SERVER_NEIGHBOR_MOVEMENT: 0x10, // 25 Bytes: [u8 opcode][u32 player_id][f32 pos_x][f32 pos_y][f32 vel_x][f32 vel_y][u32 server_tick]
  SERVER_ENTITY_SPAWN: 0x11,      // 18 Bytes: [u8 opcode][u32 entity_id][u8 entity_type][f32 pos_x][f32 pos_y][f32 health]
  SERVER_ENTITY_DESPAWN: 0x12,    // 5 Bytes:  [u8 opcode][u32 entity_id]
  SERVER_PLAYER_STATE_ACK: 0x13,  // 25 Bytes: [u8 opcode][u32 last_processed_seq][f32 pos_x][f32 pos_y][f32 vel_x][f32 vel_y][u32 server_tick]
} as const;

export type BinaryOpCode = (typeof BinaryOpCode)[keyof typeof BinaryOpCode];

// Social Plane JSON messages and DTOs over WebSocket
export type {
  FriendDto,
  FriendRequestDto,
  GroupMemberDto,
  GroupDto,
  ChatMessageDto,
  SocialMessage,
} from '../types/protocol';

// Decoded downstream binary packet representations
export type ServerBinaryPacket =
  | {
      kind: 'neighbor_movement';
      playerId: number;
      posX: number;
      posY: number;
      velX: number;
      velY: number;
      serverTick: number;
    }
  | {
      kind: 'entity_spawn';
      entityId: number;
      entityType: number;
      posX: number;
      posY: number;
      health: number;
    }
  | {
      kind: 'entity_despawn';
      entityId: number;
    }
  | {
      kind: 'player_state_ack';
      lastProcessedSeq: number;
      posX: number;
      posY: number;
      velX: number;
      velY: number;
      serverTick: number;
    };
