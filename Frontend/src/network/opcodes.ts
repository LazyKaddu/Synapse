// Opcode definitions - MUST exactly match Rust server definitions
export enum OpCode {
  // Connection Management (0x00 - 0x0F)
  HELLO = 0x00,
  HELLO_ACK = 0x01,
  PING = 0x02,
  PONG = 0x03,
  DISCONNECT = 0x04,
  ERROR = 0x05,

  // Authentication (0x10 - 0x1F)
  AUTH_CHALLENGE = 0x10,
  AUTH_RESPONSE = 0x11,
  AUTH_SUCCESS = 0x12,
  AUTH_FAILURE = 0x13,

  // Character & World (0x20 - 0x2F)
  CHARACTER_ENTER_WORLD = 0x20,
  CHARACTER_LEAVE_WORLD = 0x21,
  CHARACTER_SPAWN = 0x22,
  CHARACTER_DESPAWN = 0x23,
  CHUNK_LOAD = 0x24,
  CHUNK_UNLOAD = 0x25,
  CHUNK_DATA = 0x26,

  // Movement & Position (0x30 - 0x3F)
  ENTITY_MOVE = 0x30,
  ENTITY_POSITION = 0x31,
  ENTITY_TELEPORT = 0x32,
  PLAYER_MOVE = 0x33,
  PLAYER_POSITION_UPDATE = 0x34,

  // Combat (0x40 - 0x4F)
  ENTITY_ATTACK = 0x40,
  ENTITY_DAMAGE = 0x41,
  ENTITY_HEAL = 0x42,
  ENTITY_DEATH = 0x43,
  COMBAT_LOG = 0x44,

  // Chat & Social (0x50 - 0x5F)
  CHAT_MESSAGE = 0x50,
  CHAT_BROADCAST = 0x51,
  WHISPER = 0x52,
  PARTY_INVITE = 0x53,
  PARTY_JOIN = 0x54,
  PARTY_LEAVE = 0x55,
  GUILD_INVITE = 0x56,
  GUILD_JOIN = 0x57,

  // Inventory & Items (0x60 - 0x6F)
  INVENTORY_UPDATE = 0x60,
  ITEM_PICKUP = 0x61,
  ITEM_DROP = 0x62,
  ITEM_USE = 0x63,
  ITEM_EQUIP = 0x64,
  ITEM_UNEQUIP = 0x65,
  TRADE_REQUEST = 0x66,
  TRADE_ACCEPT = 0x67,
  TRADE_CANCEL = 0x68,

  // Skills & Abilities (0x70 - 0x7F)
  SKILL_CAST = 0x70,
  SKILL_COOLDOWN = 0x71,
  SKILL_LEARN = 0x72,
  BUFF_APPLY = 0x73,
  BUFF_REMOVE = 0x74,

  // World Events (0x80 - 0x8F)
  WORLD_EVENT = 0x80,
  WEATHER_CHANGE = 0x81,
  TIME_CHANGE = 0x82,
  NPC_SPAWN = 0x83,
  NPC_DESPAWN = 0x84,
  NPC_MOVE = 0x85,

  // Voice/WebRTC (0x90 - 0x9F)
  VOICE_JOIN = 0x90,
  VOICE_LEAVE = 0x91,
  VOICE_SPEAKING = 0x92,
  VOICE_MUTE = 0x93,

  // System (0xF0 - 0xFF)
  SERVER_SHUTDOWN = 0xF0,
  MAINTENANCE_WARNING = 0xF1,
  VERSION_MISMATCH = 0xF2,
}

// Packet structure definitions
export interface PacketHeader {
  opcode: OpCode;
  sequence: number;
  timestamp: number;
  payloadLength: number;
}

export interface BasePacket {
  opcode: OpCode;
  sequence: number;
  timestamp: number;
}

export interface HelloPacket extends BasePacket {
  opcode: OpCode.HELLO;
  clientVersion: string;
  protocolVersion: number;
}

export interface HelloAckPacket extends BasePacket {
  opcode: OpCode.HELLO_ACK;
  serverVersion: string;
  serverTime: number;
  sessionId: string;
}

export interface AuthChallengePacket extends BasePacket {
  opcode: OpCode.AUTH_CHALLENGE;
  challenge: string;
  algorithm: string;
}

export interface AuthResponsePacket extends BasePacket {
  opcode: OpCode.AUTH_RESPONSE;
  response: string;
  characterId: string;
}

export interface AuthSuccessPacket extends BasePacket {
  opcode: OpCode.AUTH_SUCCESS;
  characterId: string;
  spawnPosition: { x: number; y: number; z: number };
  worldId: string;
}

export interface EntityMovePacket extends BasePacket {
  opcode: OpCode.ENTITY_MOVE;
  entityId: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: number;
}

export interface PlayerMovePacket extends BasePacket {
  opcode: OpCode.PLAYER_MOVE;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  rotation: number;
  inputFlags: number;
}

export interface ChatMessagePacket extends BasePacket {
  opcode: OpCode.CHAT_MESSAGE;
  channel: number;
  message: string;
  targetId?: string;
}

export interface ChunkDataPacket extends BasePacket {
  opcode: OpCode.CHUNK_DATA;
  chunkX: number;
  chunkY: number;
  data: Uint8Array;
}

export interface VoiceJoinPacket extends BasePacket {
  opcode: OpCode.VOICE_JOIN;
  roomId: string;
  token: string;
}

export interface VoiceSpeakingPacket extends BasePacket {
  opcode: OpCode.VOICE_SPEAKING;
  entityId: string;
  speaking: boolean;
  volume: number;
}

// Union type for all packets
export type ClientPacket =
  | HelloPacket
  | AuthResponsePacket
  | PlayerMovePacket
  | ChatMessagePacket
  | VoiceJoinPacket;

export type ServerPacket =
  | HelloAckPacket
  | AuthChallengePacket
  | AuthSuccessPacket
  | EntityMovePacket
  | ChatMessagePacket
  | ChunkDataPacket
  | VoiceJoinPacket
  | VoiceSpeakingPacket;

// Opcode to packet type mapping for serialization
export const PACKET_TYPES: Record<OpCode, string> = {
  [OpCode.HELLO]: 'HelloPacket',
  [OpCode.HELLO_ACK]: 'HelloAckPacket',
  [OpCode.PING]: 'PingPacket',
  [OpCode.PONG]: 'PongPacket',
  [OpCode.DISCONNECT]: 'DisconnectPacket',
  [OpCode.ERROR]: 'ErrorPacket',
  [OpCode.AUTH_CHALLENGE]: 'AuthChallengePacket',
  [OpCode.AUTH_RESPONSE]: 'AuthResponsePacket',
  [OpCode.AUTH_SUCCESS]: 'AuthSuccessPacket',
  [OpCode.AUTH_FAILURE]: 'AuthFailurePacket',
  [OpCode.CHARACTER_ENTER_WORLD]: 'CharacterEnterWorldPacket',
  [OpCode.CHARACTER_LEAVE_WORLD]: 'CharacterLeaveWorldPacket',
  [OpCode.CHARACTER_SPAWN]: 'CharacterSpawnPacket',
  [OpCode.CHARACTER_DESPAWN]: 'CharacterDespawnPacket',
  [OpCode.CHUNK_LOAD]: 'ChunkLoadPacket',
  [OpCode.CHUNK_UNLOAD]: 'ChunkUnloadPacket',
  [OpCode.CHUNK_DATA]: 'ChunkDataPacket',
  [OpCode.ENTITY_MOVE]: 'EntityMovePacket',
  [OpCode.ENTITY_POSITION]: 'EntityPositionPacket',
  [OpCode.ENTITY_TELEPORT]: 'EntityTeleportPacket',
  [OpCode.PLAYER_MOVE]: 'PlayerMovePacket',
  [OpCode.PLAYER_POSITION_UPDATE]: 'PlayerPositionUpdatePacket',
  [OpCode.ENTITY_ATTACK]: 'EntityAttackPacket',
  [OpCode.ENTITY_DAMAGE]: 'EntityDamagePacket',
  [OpCode.ENTITY_HEAL]: 'EntityHealPacket',
  [OpCode.ENTITY_DEATH]: 'EntityDeathPacket',
  [OpCode.COMBAT_LOG]: 'CombatLogPacket',
  [OpCode.CHAT_MESSAGE]: 'ChatMessagePacket',
  [OpCode.CHAT_BROADCAST]: 'ChatBroadcastPacket',
  [OpCode.WHISPER]: 'WhisperPacket',
  [OpCode.PARTY_INVITE]: 'PartyInvitePacket',
  [OpCode.PARTY_JOIN]: 'PartyJoinPacket',
  [OpCode.PARTY_LEAVE]: 'PartyLeavePacket',
  [OpCode.GUILD_INVITE]: 'GuildInvitePacket',
  [OpCode.GUILD_JOIN]: 'GuildJoinPacket',
  [OpCode.INVENTORY_UPDATE]: 'InventoryUpdatePacket',
  [OpCode.ITEM_PICKUP]: 'ItemPickupPacket',
  [OpCode.ITEM_DROP]: 'ItemDropPacket',
  [OpCode.ITEM_USE]: 'ItemUsePacket',
  [OpCode.ITEM_EQUIP]: 'ItemEquipPacket',
  [OpCode.ITEM_UNEQUIP]: 'ItemUnequipPacket',
  [OpCode.TRADE_REQUEST]: 'TradeRequestPacket',
  [OpCode.TRADE_ACCEPT]: 'TradeAcceptPacket',
  [OpCode.TRADE_CANCEL]: 'TradeCancelPacket',
  [OpCode.SKILL_CAST]: 'SkillCastPacket',
  [OpCode.SKILL_COOLDOWN]: 'SkillCooldownPacket',
  [OpCode.SKILL_LEARN]: 'SkillLearnPacket',
  [OpCode.BUFF_APPLY]: 'BuffApplyPacket',
  [OpCode.BUFF_REMOVE]: 'BuffRemovePacket',
  [OpCode.WORLD_EVENT]: 'WorldEventPacket',
  [OpCode.WEATHER_CHANGE]: 'WeatherChangePacket',
  [OpCode.TIME_CHANGE]: 'TimeChangePacket',
  [OpCode.NPC_SPAWN]: 'NpcSpawnPacket',
  [OpCode.NPC_DESPAWN]: 'NpcDespawnPacket',
  [OpCode.NPC_MOVE]: 'NpcMovePacket',
  [OpCode.VOICE_JOIN]: 'VoiceJoinPacket',
  [OpCode.VOICE_LEAVE]: 'VoiceLeavePacket',
  [OpCode.VOICE_SPEAKING]: 'VoiceSpeakingPacket',
  [OpCode.VOICE_MUTE]: 'VoiceMutePacket',
  [OpCode.SERVER_SHUTDOWN]: 'ServerShutdownPacket',
  [OpCode.MAINTENANCE_WARNING]: 'MaintenanceWarningPacket',
  [OpCode.VERSION_MISMATCH]: 'VersionMismatchPacket',
};

// Helper to get opcode name for debugging
export function getOpCodeName(opcode: number): string {
  const entry = Object.entries(OpCode).find(([_, value]) => value === opcode);
  return entry ? entry[0] : `UNKNOWN_0x${opcode.toString(16).toUpperCase().padStart(2, '0')}`;
}