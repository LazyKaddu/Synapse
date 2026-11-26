// Zero-allocation binary encoder & decoder matching Synapse Rust backend wire contract

import { BinaryOpCode, type ServerBinaryPacket } from './opcodes.ts';

/**
 * Encodes an upstream 60Hz client input packet.
 * Wire Format: 10 Bytes [0x01: u8][seq: u32 LE][dx: i8][dy: i8][flags: u8 (bit 0 = sprint)][dt_ms: u16 LE]
 */
export function encodeClientInput(
  seq: number,
  dx: number,
  dy: number,
  sprint: boolean,
  dtMs: number
): Uint8Array {
  const buffer = new ArrayBuffer(10);
  const view = new DataView(buffer);
  view.setUint8(0, BinaryOpCode.CLIENT_INPUT);
  view.setUint32(1, seq >>> 0, true);
  view.setInt8(5, Math.max(-1, Math.min(1, Math.trunc(dx))));
  view.setInt8(6, Math.max(-1, Math.min(1, Math.trunc(dy))));
  view.setUint8(7, sprint ? 0x01 : 0x00);
  view.setUint16(8, Math.max(0, Math.min(0xffff, Math.round(dtMs))), true);
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
  view.setUint32(1, actionId >>> 0, true);
  return new Uint8Array(buffer);
}

/**
 * Encodes an upstream client teleport request.
 * Wire Format: 9 Bytes [0x03: u8][pos_x: f32 LE][pos_y: f32 LE]
 */
export function encodeClientTeleport(posX: number, posY: number): Uint8Array {
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, BinaryOpCode.CLIENT_TELEPORT);
  view.setFloat32(1, posX, true);
  view.setFloat32(5, posY, true);
  return new Uint8Array(buffer);
}

/**
 * @deprecated Use encodeClientTeleport or encodeClientInput.
 */
export function encodeClientMovement(posX: number, posY: number): Uint8Array {
  return encodeClientTeleport(posX, posY);
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
      if (buffer.byteLength < 25) return null;
      const playerId = view.getUint32(1, true);
      const posX = view.getFloat32(5, true);
      const posY = view.getFloat32(9, true);
      const velX = view.getFloat32(13, true);
      const velY = view.getFloat32(17, true);
      const serverTick = view.getUint32(21, true);
      return {
        kind: 'neighbor_movement',
        playerId,
        posX,
        posY,
        velX,
        velY,
        serverTick,
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

    case BinaryOpCode.SERVER_PLAYER_STATE_ACK: {
      if (buffer.byteLength < 25) return null;
      const lastProcessedSeq = view.getUint32(1, true);
      const posX = view.getFloat32(5, true);
      const posY = view.getFloat32(9, true);
      const velX = view.getFloat32(13, true);
      const velY = view.getFloat32(17, true);
      const serverTick = view.getUint32(21, true);
      return {
        kind: 'player_state_ack',
        lastProcessedSeq,
        posX,
        posY,
        velX,
        velY,
        serverTick,
      };
    }

    default:
      return null;
  }
}
