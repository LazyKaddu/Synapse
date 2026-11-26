import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BinaryOpCode } from '../network/opcodes.ts';
import {
  encodeClientInput,
  encodeClientAction,
  encodeClientTeleport,
  decodeServerBinaryPacket,
} from '../network/binary.ts';

describe('Binary Protocol Wire Format', () => {
  describe('BinaryOpCode constants', () => {
    it('matches Rust backend opcodes', () => {
      assert.strictEqual(BinaryOpCode.CLIENT_INPUT, 0x01);
      assert.strictEqual(BinaryOpCode.CLIENT_ACTION, 0x02);
      assert.strictEqual(BinaryOpCode.CLIENT_TELEPORT, 0x03);
      assert.strictEqual(BinaryOpCode.SERVER_NEIGHBOR_MOVEMENT, 0x10);
      assert.strictEqual(BinaryOpCode.SERVER_ENTITY_SPAWN, 0x11);
      assert.strictEqual(BinaryOpCode.SERVER_ENTITY_DESPAWN, 0x12);
      assert.strictEqual(BinaryOpCode.SERVER_PLAYER_STATE_ACK, 0x13);
    });
  });

  describe('encodeClientInput', () => {
    it('encodes 10-byte CLIENT_INPUT packet with little-endian fields and signed i8 axes', () => {
      const bytes = encodeClientInput(42, -1, 1, true, 17);
      assert.strictEqual(bytes.byteLength, 10);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.strictEqual(view.getUint8(0), 0x01);
      assert.strictEqual(view.getUint32(1, true), 42);
      assert.strictEqual(view.getInt8(5), -1);
      assert.strictEqual(view.getInt8(6), 1);
      assert.strictEqual(view.getUint8(7), 0x01); // sprint bit 0 set
      assert.strictEqual(view.getUint16(8, true), 17);
    });

    it('encodes flags = 0 when sprint is false and handles large seq/dtMs', () => {
      const bytes = encodeClientInput(0x12345678, 0, -1, false, 100);
      assert.strictEqual(bytes.byteLength, 10);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.strictEqual(view.getUint8(0), 0x01);
      assert.strictEqual(view.getUint32(1, true), 0x12345678);
      assert.strictEqual(view.getInt8(5), 0);
      assert.strictEqual(view.getInt8(6), -1);
      assert.strictEqual(view.getUint8(7), 0x00);
      assert.strictEqual(view.getUint16(8, true), 100);
    });
  });

  describe('encodeClientAction', () => {
    it('encodes 5-byte CLIENT_ACTION packet', () => {
      const bytes = encodeClientAction(987654);
      assert.strictEqual(bytes.byteLength, 5);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.strictEqual(view.getUint8(0), 0x02);
      assert.strictEqual(view.getUint32(1, true), 987654);
    });
  });

  describe('encodeClientTeleport', () => {
    it('encodes 9-byte CLIENT_TELEPORT packet with f32 LE coordinates', () => {
      const bytes = encodeClientTeleport(1234.5, -678.25);
      assert.strictEqual(bytes.byteLength, 9);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.strictEqual(view.getUint8(0), 0x03);
      assert.strictEqual(view.getFloat32(1, true), 1234.5);
      assert.strictEqual(view.getFloat32(5, true), -678.25);
    });
  });

  describe('decodeServerBinaryPacket', () => {
    it('decodes 25-byte SERVER_NEIGHBOR_MOVEMENT packet', () => {
      const buf = new ArrayBuffer(25);
      const view = new DataView(buf);
      view.setUint8(0, BinaryOpCode.SERVER_NEIGHBOR_MOVEMENT);
      view.setUint32(1, 77, true);
      view.setFloat32(5, 320.5, true);
      view.setFloat32(9, -128.25, true);
      view.setFloat32(13, 240.0, true);
      view.setFloat32(17, -120.0, true);
      view.setUint32(21, 9001, true);

      const decoded = decodeServerBinaryPacket(buf);
      assert.deepStrictEqual(decoded, {
        kind: 'neighbor_movement',
        playerId: 77,
        posX: 320.5,
        posY: -128.25,
        velX: 240.0,
        velY: -120.0,
        serverTick: 9001,
      });
    });

    it('returns null for truncated SERVER_NEIGHBOR_MOVEMENT packet', () => {
      const buf = new ArrayBuffer(13);
      new DataView(buf).setUint8(0, BinaryOpCode.SERVER_NEIGHBOR_MOVEMENT);
      assert.strictEqual(decodeServerBinaryPacket(buf), null);
    });

    it('decodes 25-byte SERVER_PLAYER_STATE_ACK packet', () => {
      const buf = new ArrayBuffer(25);
      const view = new DataView(buf);
      view.setUint8(0, BinaryOpCode.SERVER_PLAYER_STATE_ACK);
      view.setUint32(1, 155, true);
      view.setFloat32(5, 512.0, true);
      view.setFloat32(9, 256.5, true);
      view.setFloat32(13, 0.0, true);
      view.setFloat32(17, 480.0, true);
      view.setUint32(21, 1200, true);

      const decoded = decodeServerBinaryPacket(buf);
      assert.deepStrictEqual(decoded, {
        kind: 'player_state_ack',
        lastProcessedSeq: 155,
        posX: 512.0,
        posY: 256.5,
        velX: 0.0,
        velY: 480.0,
        serverTick: 1200,
      });
    });

    it('returns null for truncated SERVER_PLAYER_STATE_ACK packet', () => {
      const buf = new ArrayBuffer(24);
      new DataView(buf).setUint8(0, BinaryOpCode.SERVER_PLAYER_STATE_ACK);
      assert.strictEqual(decodeServerBinaryPacket(buf), null);
    });

    it('decodes 18-byte SERVER_ENTITY_SPAWN packet', () => {
      const buf = new ArrayBuffer(18);
      const view = new DataView(buf);
      view.setUint8(0, BinaryOpCode.SERVER_ENTITY_SPAWN);
      view.setUint32(1, 1001, true);
      view.setUint8(5, 2);
      view.setFloat32(6, 64.0, true);
      view.setFloat32(10, 128.0, true);
      view.setFloat32(14, 100.0, true);

      const decoded = decodeServerBinaryPacket(buf);
      assert.deepStrictEqual(decoded, {
        kind: 'entity_spawn',
        entityId: 1001,
        entityType: 2,
        posX: 64.0,
        posY: 128.0,
        health: 100.0,
      });
    });

    it('decodes 5-byte SERVER_ENTITY_DESPAWN packet', () => {
      const buf = new ArrayBuffer(5);
      const view = new DataView(buf);
      view.setUint8(0, BinaryOpCode.SERVER_ENTITY_DESPAWN);
      view.setUint32(1, 1001, true);

      const decoded = decodeServerBinaryPacket(buf);
      assert.deepStrictEqual(decoded, {
        kind: 'entity_despawn',
        entityId: 1001,
      });
    });

    it('returns null for empty buffer or unknown opcode', () => {
      assert.strictEqual(decodeServerBinaryPacket(new ArrayBuffer(0)), null);
      const unknown = new ArrayBuffer(10);
      new DataView(unknown).setUint8(0, 0xff);
      assert.strictEqual(decodeServerBinaryPacket(unknown), null);
    });
  });
});
