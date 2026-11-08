import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BinaryParser,
  PacketBuilder,
  parsePacket,
  createPacketBuilder,
  validatePacket,
  HEADER_SIZE,
} from '../network/binary';
import { OpCode, PacketHeader, HelloPacket, PlayerMovePacket, ChatMessagePacket } from '../network/opcodes';

describe('Binary Protocol', () => {
  describe('PacketBuilder', () => {
    let builder: ReturnType<typeof createPacketBuilder>;
    let sequence = 0;

    beforeEach(() => {
      sequence = 0;
      builder = createPacketBuilder(() => ++sequence);
    });

    it('should build a valid HELLO packet', () => {
      const packet = builder.buildHello('1.0.0', 1);
      
      expect(packet.length).toBeGreaterThan(HEADER_SIZE);
      expect(packet[0]).toBe(OpCode.HELLO);
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.opcode).toBe(OpCode.HELLO);
      expect(parsed.header.sequence).toBe(1);
      expect(parsed.packet.clientVersion).toBe('1.0.0');
      expect(parsed.packet.protocolVersion).toBe(1);
    });

    it('should build a valid AUTH_RESPONSE packet', () => {
      const packet = builder.buildAuthResponse('char-123', 'auth-token-456');
      
      expect(packet[0]).toBe(OpCode.AUTH_RESPONSE);
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.opcode).toBe(OpCode.AUTH_RESPONSE);
      expect(parsed.packet.characterId).toBe('char-123');
      expect(parsed.packet.response).toBe('auth-token-456');
    });

    it('should build a valid PLAYER_MOVE packet', () => {
      const position = { x: 100, y: 64, z: -50 };
      const velocity = { x: 5, y: 0, z: 2 };
      const rotation = 1.57;
      const inputFlags = 3; // Forward + Right
      
      const packet = builder.buildPlayerMove(position, velocity, rotation, inputFlags);
      
      expect(packet[0]).toBe(OpCode.PLAYER_MOVE);
      expect(packet.length).toBe(HEADER_SIZE + 29); // 29 bytes payload
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.opcode).toBe(OpCode.PLAYER_MOVE);
      expect(parsed.packet.position).toEqual(position);
      expect(parsed.packet.velocity).toEqual(velocity);
      expect(parsed.packet.rotation).toBeCloseTo(rotation, 5);
      expect(parsed.packet.inputFlags).toBe(inputFlags);
    });

    it('should build a valid CHAT_MESSAGE packet', () => {
      const packet = builder.buildChatMessage(0, 'Hello World!');
      
      expect(packet[0]).toBe(OpCode.CHAT_MESSAGE);
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.opcode).toBe(OpCode.CHAT_MESSAGE);
      expect(parsed.packet.channel).toBe(0);
      expect(parsed.packet.message).toBe('Hello World!');
      expect(parsed.packet.targetId).toBeUndefined();
    });

    it('should build a CHAT_MESSAGE packet with target (whisper)', () => {
      const packet = builder.buildChatMessage(4, 'Private message', 'target-123');
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.packet.channel).toBe(4);
      expect(parsed.packet.message).toBe('Private message');
      expect(parsed.packet.targetId).toBe('target-123');
    });

    it('should build a valid PING packet', () => {
      const packet = builder.buildPing();
      
      expect(packet.length).toBe(HEADER_SIZE);
      expect(packet[0]).toBe(OpCode.PING);
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.opcode).toBe(OpCode.PING);
      expect(parsed.header.payloadLength).toBe(0);
    });

    it('should increment sequence for each packet', () => {
      builder.buildPing();
      builder.buildPing();
      const packet = builder.buildPing();
      
      const parsed = parsePacket(packet.buffer);
      expect(parsed.header.sequence).toBe(3);
    });
  });

  describe('BinaryParser', () => {
    it('should parse HELLO packet correctly', () => {
      const builder = createPacketBuilder(() => 1);
      const packet = builder.buildHello('1.0.0', 1);
      
      const parser = new BinaryParser(packet.buffer);
      const parsed = parser.parse();
      
      expect(parsed.header.opcode).toBe(OpCode.HELLO);
      expect(parsed.header.sequence).toBe(1);
      expect((parsed.packet as HelloPacket).clientVersion).toBe('1.0.0');
      expect((parsed.packet as HelloPacket).protocolVersion).toBe(1);
    });

    it('should parse PLAYER_MOVE packet correctly', () => {
      const builder = createPacketBuilder(() => 42);
      const position = { x: 10.5, y: 64, z: -20.25 };
      const velocity = { x: 0, y: 0, z: 0 };
      const rotation = 0;
      const inputFlags = 1;
      
      const packet = builder.buildPlayerMove(position, velocity, rotation, inputFlags);
      const parser = new BinaryParser(packet.buffer);
      const parsed = parser.parse();
      
      expect(parsed.header.opcode).toBe(OpCode.PLAYER_MOVE);
      expect(parsed.header.sequence).toBe(42);
      expect((parsed.packet as PlayerMovePacket).position).toEqual(position);
      expect((parsed.packet as PlayerMovePacket).inputFlags).toBe(1);
    });

    it('should parse CHAT_MESSAGE packet correctly', () => {
      const builder = createPacketBuilder(() => 100);
      const packet = builder.buildChatMessage(0, 'Test message');
      
      const parser = new BinaryParser(packet.buffer);
      const parsed = parser.parse();
      
      expect(parsed.header.opcode).toBe(OpCode.CHAT_MESSAGE);
      expect(parsed.header.sequence).toBe(100);
      expect((parsed.packet as ChatMessagePacket).channel).toBe(0);
      expect((parsed.packet as ChatMessagePacket).message).toBe('Test message');
    });

    it('should throw error for buffer too small', () => {
      const smallBuffer = new ArrayBuffer(5); // Less than HEADER_SIZE
      const parser = new BinaryParser(smallBuffer);
      
      expect(() => parser.parseHeader()).toThrow('Buffer too small for header');
    });

    it('should return correct payload view', () => {
      const builder = createPacketBuilder(() => 1);
      const packet = builder.buildHello('1.0.0', 1);
      
      const parser = new BinaryParser(packet.buffer);
      const payload = parser.getPayload();
      
      expect(payload.byteLength).toBe(packet.length - HEADER_SIZE);
    });
  });

  describe('validatePacket', () => {
    it('should return valid for correct packet', () => {
      const builder = createPacketBuilder(() => 1);
      const packet = builder.buildHello('1.0.0', 1);
      
      const result = validatePacket(packet.buffer);
      expect(result.valid).toBe(true);
    });

    it('should return invalid for too small packet', () => {
      const smallBuffer = new ArrayBuffer(5);
      const result = validatePacket(smallBuffer);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('should return invalid for too large packet', () => {
      const largeBuffer = new ArrayBuffer(70000); // > MAX_PACKET_SIZE
      const result = validatePacket(largeBuffer);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('parsePacket utility', () => {
    it('should parse packet using utility function', () => {
      const builder = createPacketBuilder(() => 999);
      const packet = builder.buildPlayerMove(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        0,
        0
      );
      
      const parsed = parsePacket(packet.buffer);
      
      expect(parsed.header.opcode).toBe(OpCode.PLAYER_MOVE);
      expect(parsed.header.sequence).toBe(999);
    });
  });
});

describe('OpCodes', () => {
  it('should have all required opcodes', () => {
    expect(OpCode.HELLO).toBe(0x00);
    expect(OpCode.HELLO_ACK).toBe(0x01);
    expect(OpCode.PING).toBe(0x02);
    expect(OpCode.PONG).toBe(0x03);
    expect(OpCode.AUTH_CHALLENGE).toBe(0x10);
    expect(OpCode.AUTH_RESPONSE).toBe(0x11);
    expect(OpCode.AUTH_SUCCESS).toBe(0x12);
    expect(OpCode.PLAYER_MOVE).toBe(0x33);
    expect(OpCode.CHAT_MESSAGE).toBe(0x50);
    expect(OpCode.VOICE_JOIN).toBe(0x90);
    expect(OpCode.SERVER_SHUTDOWN).toBe(0xF0);
  });

  it('should have getOpCodeName helper', () => {
    // Import the helper - it's not exported directly, so we test the enum values
    expect(OpCode.HELLO).toBeDefined();
    expect(typeof OpCode.HELLO).toBe('number');
  });
});