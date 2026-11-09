// Protocol opcodes and message definitions matching Synapse Rust backend wire contract

export const BinaryOpCode = {
  // Client -> Server (Upstream)
  CLIENT_MOVEMENT: 0x01, // 9 Bytes: [u8 opcode] [f32 pos_x] [f32 pos_y]
  CLIENT_ACTION: 0x02,   // 5 Bytes: [u8 opcode] [u32 action_id]

  // Server -> Client (Downstream)
  SERVER_NEIGHBOR_MOVEMENT: 0x10, // 13 Bytes: [u8 opcode] [u32 player_id] [f32 pos_x] [f32 pos_y]
  SERVER_ENTITY_SPAWN: 0x11,      // 18 Bytes: [u8 opcode] [u32 entity_id] [u8 entity_type] [f32 pos_x] [f32 pos_y] [f32 health]
  SERVER_ENTITY_DESPAWN: 0x12,    // 5 Bytes:  [u8 opcode] [u32 entity_id]
} as const;

export type BinaryOpCode = (typeof BinaryOpCode)[keyof typeof BinaryOpCode];

// Social Plane JSON messages over WebSocket
export type SocialMessage =
  | {
      type: 'VOICE_JOIN';
      sfu_url: string;
      token: string;
    }
  | {
      type: 'VOICE_SET_TRACKS';
      subscribe_to: string[];
    }
  | {
      type: 'CHAT_MSG';
      channel: string;
      sender: string;
      content: string;
    }
  | {
      type: 'PHONE_RING';
      caller_id: number;
      target_id: number;
    }
  | {
      type: 'PHONE_ANSWER';
      caller_id: number;
      target_id: number;
      accepted: boolean;
    }
  | {
      type: 'PHONE_HANGUP';
      session_id: string;
    }
  | {
      type: 'SERVER_RESTART';
      message: string;
    };

// Decoded downstream binary packet representations
export type ServerBinaryPacket =
  | {
      kind: 'neighbor_movement';
      playerId: number;
      posX: number;
      posY: number;
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
    };
