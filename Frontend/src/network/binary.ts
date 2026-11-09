// Zero-allocation binary encoder & decoder matching Synapse Rust backend wire contract

import { BinaryOpCode, type ServerBinaryPacket } from './opcodes.ts';

/**
 * Encodes an upstream 60Hz client movement packet.
 * Wire Format: 9 Bytes [0x01: u8][pos_x: f32 LE][pos_y: f32 LE]
 */
export function encodeClientMovement(posX: number, posY: number): Uint8Array {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, BinaryOpCode.CLIENT_MOVEMENT);
  view.setFloat32(1, posX, true); // true = little-endian
  view.setFloat32(5, posY, true);
  return new Uint8Array(buffer);
}

/**
 * Encodes an upstream client action trigger.
 * Wire Format: 5 Bytes [0x02: u8][action_id: u32 LE]
 */
export function encodeClientAction(actionId: number): Uint8Array {
  const buffer = new ArrayBuffer(5);
  const view = new DataView(buffer);
  view.setUint8(0, BinaryOpCode.CLIENT_ACTION);
  view.setUint32(1, actionId, true);
  return new Uint8Array(buffer);
}

/**
 * Decodes a downstream binary packet received from the game server.
 */
export function decodeServerBinaryPacket(buffer: ArrayBuffer): ServerBinaryPacket | null {
  if (buffer.byteLength < 1) {
    return null;
  }

  const view = new DataView(buffer);
  const opcode = view.getUint8(0);

  switch (opcode) {
    case BinaryOpCode.SERVER_NEIGHBOR_MOVEMENT: {
      if (buffer.byteLength < 13) return null;
      const playerId = view.getUint32(1, true);
      const posX = view.getFloat32(5, true);
      const posY = view.getFloat32(9, true);
      return {
        kind: 'neighbor_movement',
        playerId,
        posX,
        posY,
      };
    }

    case BinaryOpCode.SERVER_ENTITY_SPAWN: {
      if (buffer.byteLength < 18) return null;
      const entityId = view.getUint32(1, true);
      const entityType = view.getUint8(5);
      const posX = view.getFloat32(6, true);
      const posY = view.getFloat32(10, true);
      const health = view.getFloat32(14, true);
      return {
        kind: 'entity_spawn',
        entityId,
        entityType,
        posX,
        posY,
        health,
      };
    }

    case BinaryOpCode.SERVER_ENTITY_DESPAWN: {
      if (buffer.byteLength < 5) return null;
      const entityId = view.getUint32(1, true);
      return {
        kind: 'entity_despawn',
        entityId,
      };
    }

    default:
      return null;
  }
}
