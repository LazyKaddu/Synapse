// Binary packet parser for 13-byte ArrayBuffer protocol
// Format: [opcode:u8][sequence:u32][timestamp:u64][payload:variable]
// Header is always 13 bytes: 1 + 4 + 8 = 13 bytes

import { OpCode, PacketHeader, BasePacket, ClientPacket, ServerPacket } from './opcodes';

export const HEADER_SIZE = 13; // 1 byte opcode + 4 bytes sequence + 8 bytes timestamp
export const MAX_PACKET_SIZE = 65535; // 64KB max packet size

export interface ParsedPacket<T extends BasePacket = BasePacket> {
  header: PacketHeader;
  payload: DataView;
  packet: T;
}

export class BinaryParser {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  // Parse header (13 bytes)
  parseHeader(): PacketHeader {
    if (this.buffer.byteLength < HEADER_SIZE) {
      throw new Error(`Buffer too small for header: ${this.buffer.byteLength} < ${HEADER_SIZE}`);
    }

    const opcode = this.view.getUint8(0);
    const sequence = this.view.getUint32(1, true); // little-endian
    const timestamp = this.view.getBigUint64(5, true); // little-endian
    const payloadLength = this.buffer.byteLength - HEADER_SIZE;

    return {
      opcode: opcode as OpCode,
      sequence,
      timestamp: Number(timestamp),
      payloadLength,
    };
  }

  // Get payload as DataView (offset after header)
  getPayload(): DataView {
    return new DataView(this.buffer, HEADER_SIZE);
  }

  // Parse complete packet
  parse<T extends BasePacket = BasePacket>(): ParsedPacket<T> {
    const header = this.parseHeader();
    const payload = this.getPayload();
    const packet = this.deserializePacket(header, payload) as T;

    return { header, payload, packet };
  }

  // Deserialize packet based on opcode
  private deserializePacket(header: PacketHeader, payload: DataView): BasePacket {
    const basePacket: BasePacket = {
      opcode: header.opcode,
      sequence: header.sequence,
      timestamp: header.timestamp,
    };

    switch (header.opcode) {
      case OpCode.HELLO:
        return this.deserializeHello(payload, basePacket);
      case OpCode.HELLO_ACK:
        return this.deserializeHelloAck(payload, basePacket);
      case OpCode.AUTH_CHALLENGE:
        return this.deserializeAuthChallenge(payload, basePacket);
      case OpCode.AUTH_RESPONSE:
        return this.deserializeAuthResponse(payload, basePacket);
      case OpCode.AUTH_SUCCESS:
        return this.deserializeAuthSuccess(payload, basePacket);
      case OpCode.ENTITY_MOVE:
        return this.deserializeEntityMove(payload, basePacket);
      case OpCode.PLAYER_MOVE:
        return this.deserializePlayerMove(payload, basePacket);
      case OpCode.CHAT_MESSAGE:
        return this.deserializeChatMessage(payload, basePacket);
      case OpCode.CHUNK_DATA:
        return this.deserializeChunkData(payload, basePacket);
      case OpCode.VOICE_JOIN:
        return this.deserializeVoiceJoin(payload, basePacket);
      case OpCode.VOICE_SPEAKING:
        return this.deserializeVoiceSpeaking(payload, basePacket);
      default:
        // Return base packet for unknown opcodes
        return basePacket;
    }
  }

  // Deserialization helpers
  private readString(view: DataView, offset: number, length: number): string {
    const decoder = new TextDecoder();
    return decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset, length));
  }

  private readVec3(view: DataView, offset: number): { x: number; y: number; z: number } {
    return {
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 4, true),
      z: view.getFloat32(offset + 8, true),
    };
  }

  private deserializeHello(payload: DataView, base: BasePacket) {
    // Hello: [protocolVersion:u16][clientVersionLen:u8][clientVersion:string]
    const protocolVersion = payload.getUint16(0, true);
    const versionLen = payload.getUint8(2);
    const clientVersion = this.readString(payload, 3, versionLen);
    return { ...base, opcode: OpCode.HELLO, clientVersion, protocolVersion };
  }

  private deserializeHelloAck(payload: DataView, base: BasePacket) {
    // HelloAck: [serverVersionLen:u8][serverVersion:string][serverTime:u64][sessionIdLen:u8][sessionId:string]
    let offset = 0;
    const serverVersionLen = payload.getUint8(offset++);
    const serverVersion = this.readString(payload, offset, serverVersionLen);
    offset += serverVersionLen;
    const serverTime = Number(payload.getBigUint64(offset, true));
    offset += 8;
    const sessionIdLen = payload.getUint8(offset++);
    const sessionId = this.readString(payload, offset, sessionIdLen);
    return { ...base, opcode: OpCode.HELLO_ACK, serverVersion, serverTime, sessionId };
  }

  private deserializeAuthChallenge(payload: DataView, base: BasePacket) {
    // AuthChallenge: [algorithmLen:u8][algorithm:string][challengeLen:u8][challenge:string]
    let offset = 0;
    const algorithmLen = payload.getUint8(offset++);
    const algorithm = this.readString(payload, offset, algorithmLen);
    offset += algorithmLen;
    const challengeLen = payload.getUint8(offset++);
    const challenge = this.readString(payload, offset, challengeLen);
    return { ...base, opcode: OpCode.AUTH_CHALLENGE, algorithm, challenge };
  }

  private deserializeAuthResponse(payload: DataView, base: BasePacket) {
    // AuthResponse: [characterIdLen:u8][characterId:string][responseLen:u8][response:string]
    let offset = 0;
    const characterIdLen = payload.getUint8(offset++);
    const characterId = this.readString(payload, offset, characterIdLen);
    offset += characterIdLen;
    const responseLen = payload.getUint8(offset++);
    const response = this.readString(payload, offset, responseLen);
    return { ...base, opcode: OpCode.AUTH_RESPONSE, characterId, response };
  }

  private deserializeAuthSuccess(payload: DataView, base: BasePacket) {
    // AuthSuccess: [characterIdLen:u8][characterId:string][worldIdLen:u8][worldId:string][spawnX:f32][spawnY:f32][spawnZ:f32]
    let offset = 0;
    const characterIdLen = payload.getUint8(offset++);
    const characterId = this.readString(payload, offset, characterIdLen);
    offset += characterIdLen;
    const worldIdLen = payload.getUint8(offset++);
    const worldId = this.readString(payload, offset, worldIdLen);
    offset += worldIdLen;
    const spawnPosition = this.readVec3(payload, offset);
    return { ...base, opcode: OpCode.AUTH_SUCCESS, characterId, spawnPosition, worldId };
  }

  private deserializeEntityMove(payload: DataView, base: BasePacket) {
    // EntityMove: [entityIdLen:u8][entityId:string][posX:f32][posY:f32][posZ:f32][velX:f32][velY:f32][velZ:f32][rotation:f32]
    let offset = 0;
    const entityIdLen = payload.getUint8(offset++);
    const entityId = this.readString(payload, offset, entityIdLen);
    offset += entityIdLen;
    const position = this.readVec3(payload, offset);
    offset += 12;
    const velocity = this.readVec3(payload, offset);
    offset += 12;
    const rotation = payload.getFloat32(offset, true);
    return { ...base, opcode: OpCode.ENTITY_MOVE, entityId, position, velocity, rotation };
  }

  private deserializePlayerMove(payload: DataView, base: BasePacket) {
    // PlayerMove: [posX:f32][posY:f32][posZ:f32][velX:f32][velY:f32][velZ:f32][rotation:f32][inputFlags:u8]
    const position = this.readVec3(payload, 0);
    const velocity = this.readVec3(payload, 12);
    const rotation = payload.getFloat32(24, true);
    const inputFlags = payload.getUint8(28);
    return { ...base, opcode: OpCode.PLAYER_MOVE, position, velocity, rotation, inputFlags };
  }

  private deserializeChatMessage(payload: DataView, base: BasePacket) {
    // ChatMessage: [channel:u8][messageLen:u16][message:string][targetIdLen:u8?][targetId:string?]
    let offset = 0;
    const channel = payload.getUint8(offset++);
    const messageLen = payload.getUint16(offset, true);
    offset += 2;
    const message = this.readString(payload, offset, messageLen);
    offset += messageLen;
    
    let targetId: string | undefined;
    if (offset < payload.byteLength) {
      const targetIdLen = payload.getUint8(offset++);
      targetId = this.readString(payload, offset, targetIdLen);
    }
    return { ...base, opcode: OpCode.CHAT_MESSAGE, channel, message, targetId };
  }

  private deserializeChunkData(payload: DataView, base: BasePacket) {
    // ChunkData: [chunkX:i32][chunkY:i32][dataLen:u32][data:bytes]
    const chunkX = payload.getInt32(0, true);
    const chunkY = payload.getInt32(4, true);
    const dataLen = payload.getUint32(8, true);
    const data = new Uint8Array(payload.buffer, payload.byteOffset + 12, dataLen);
    return { ...base, opcode: OpCode.CHUNK_DATA, chunkX, chunkY, data };
  }

  private deserializeVoiceJoin(payload: DataView, base: BasePacket) {
    // VoiceJoin: [roomIdLen:u8][roomId:string][tokenLen:u8][token:string]
    let offset = 0;
    const roomIdLen = payload.getUint8(offset++);
    const roomId = this.readString(payload, offset, roomIdLen);
    offset += roomIdLen;
    const tokenLen = payload.getUint8(offset++);
    const token = this.readString(payload, offset, tokenLen);
    return { ...base, opcode: OpCode.VOICE_JOIN, roomId, token };
  }

  private deserializeVoiceSpeaking(payload: DataView, base: BasePacket) {
    // VoiceSpeaking: [entityIdLen:u8][entityId:string][speaking:u8][volume:f32]
    let offset = 0;
    const entityIdLen = payload.getUint8(offset++);
    const entityId = this.readString(payload, offset, entityIdLen);
    offset += entityIdLen;
    const speaking = payload.getUint8(offset++) === 1;
    const volume = payload.getFloat32(offset, true);
    return { ...base, opcode: OpCode.VOICE_SPEAKING, entityId, speaking, volume };
  }
}

// Builder for creating outgoing packets
export class PacketBuilder {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;
  private sequence = 0;

  constructor(private getSequence: () => number) {}

  // Write header placeholder (will be filled in build())
  private writeHeader(opcode: OpCode, payloadLength: number): Uint8Array {
    const header = new Uint8Array(HEADER_SIZE);
    const view = new DataView(header.buffer);
    view.setUint8(0, opcode);
    view.setUint32(1, this.getSequence(), true);
    view.setBigUint64(5, BigInt(Date.now()), true);
    return header;
  }

  buildHello(clientVersion: string, protocolVersion: number): Uint8Array {
    const versionBytes = new TextEncoder().encode(clientVersion);
    const payload = new Uint8Array(3 + versionBytes.length);
    const view = new DataView(payload.buffer);
    view.setUint16(0, protocolVersion, true);
    view.setUint8(2, versionBytes.length);
    payload.set(versionBytes, 3);

    const header = this.writeHeader(OpCode.HELLO, payload.length);
    return this.concat([header, payload]);
  }

  buildAuthResponse(characterId: string, response: string): Uint8Array {
    const charIdBytes = new TextEncoder().encode(characterId);
    const responseBytes = new TextEncoder().encode(response);
    const payload = new Uint8Array(2 + charIdBytes.length + 1 + responseBytes.length);
    let offset = 0;
    payload[offset++] = charIdBytes.length;
    payload.set(charIdBytes, offset);
    offset += charIdBytes.length;
    payload[offset++] = responseBytes.length;
    payload.set(responseBytes, offset);

    const header = this.writeHeader(OpCode.AUTH_RESPONSE, payload.length);
    return this.concat([header, payload]);
  }

  buildPlayerMove(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    rotation: number,
    inputFlags: number
  ): Uint8Array {
    const payload = new Uint8Array(29); // 3*4 + 3*4 + 4 + 1 = 29 bytes
    const view = new DataView(payload.buffer);
    view.setFloat32(0, position.x, true);
    view.setFloat32(4, position.y, true);
    view.setFloat32(8, position.z, true);
    view.setFloat32(12, velocity.x, true);
    view.setFloat32(16, velocity.y, true);
    view.setFloat32(20, velocity.z, true);
    view.setFloat32(24, rotation, true);
    view.setUint8(28, inputFlags);

    const header = this.writeHeader(OpCode.PLAYER_MOVE, payload.length);
    return this.concat([header, payload]);
  }

  buildChatMessage(channel: number, message: string, targetId?: string): Uint8Array {
    const messageBytes = new TextEncoder().encode(message);
    const targetBytes = targetId ? new TextEncoder().encode(targetId) : new Uint8Array(0);
    const payload = new Uint8Array(1 + 2 + messageBytes.length + (targetBytes.length > 0 ? 1 + targetBytes.length : 0));
    
    let offset = 0;
    payload[offset++] = channel;
    const view = new DataView(payload.buffer, offset, 2);
    view.setUint16(0, messageBytes.length, true);
    offset += 2;
    payload.set(messageBytes, offset);
    offset += messageBytes.length;
    
    if (targetBytes.length > 0) {
      payload[offset++] = targetBytes.length;
      payload.set(targetBytes, offset);
    }

    const header = this.writeHeader(OpCode.CHAT_MESSAGE, payload.length);
    return this.concat([header, payload]);
  }

  buildPing(): Uint8Array {
    const header = this.writeHeader(OpCode.PING, 0);
    return header;
  }

  private concat(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

// Utility functions
export function parsePacket(buffer: ArrayBuffer): ParsedPacket {
  const parser = new BinaryParser(buffer);
  return parser.parse();
}

export function createPacketBuilder(getSequence: () => number): PacketBuilder {
  return new PacketBuilder(getSequence);
}

// Validation
export function validatePacket(buffer: ArrayBuffer): { valid: boolean; error?: string } {
  if (buffer.byteLength < HEADER_SIZE) {
    return { valid: false, error: `Packet too small: ${buffer.byteLength} bytes` };
  }
  if (buffer.byteLength > MAX_PACKET_SIZE) {
    return { valid: false, error: `Packet too large: ${buffer.byteLength} bytes` };
  }
  return { valid: true };
}