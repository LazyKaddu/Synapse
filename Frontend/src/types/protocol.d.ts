// Global TypeScript Definitions - Interfaces mirroring Rust structs exactly

// Base types
export type EntityId = string;
export type AccountId = string;
export type CharacterId = string;
export type ChunkKey = string;
export type WorldId = string;
export type SessionId = string;

// Vector types
export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

// Health
export interface Health {
  current: number;
  max: number;
}

// Stats
export interface Stats {
  strength: number;
  agility: number;
  intelligence: number;
  vitality: number;
  spirit: number;
}

// Character class
export enum CharacterClass {
  WARRIOR = 0,
  MAGE = 1,
  ROGUE = 2,
  RANGER = 3,
  CLERIC = 4,
  PALADIN = 5,
  NECROMANCER = 6,
  DRUID = 7,
}

// Character
export interface Character {
  id: CharacterId;
  accountId: AccountId;
  name: string;
  class: CharacterClass;
  level: number;
  experience: number;
  position: Vector3;
  health: Health;
  stats: Stats;
  createdAt: number;
  lastLoginAt: number;
}

// Entity base
export interface Entity {
  id: EntityId;
  entityType: EntityType;
  position: Vector3;
  velocity: Vector3;
  rotation: number;
  health: Health;
  metadata: Record<string, unknown>;
}

export enum EntityType {
  PLAYER = 0,
  MONSTER = 1,
  NPC = 2,
  PROJECTILE = 3,
  ITEM_DROP = 4,
}

// Player (extends Entity)
export interface Player extends Entity {
  entityType: EntityType.PLAYER;
  accountId: AccountId;
  characterId: CharacterId;
  name: string;
  class: CharacterClass;
  level: number;
  experience: number;
  stats: Stats;
  mana: { current: number; max: number };
  stamina: { current: number; max: number };
  inventory: InventorySlot[];
  equipment: EquipmentSlots;
  skills: Skill[];
  buffs: Buff[];
}

// Monster (extends Entity)
export interface Monster extends Entity {
  entityType: EntityType.MONSTER;
  monsterId: string; // Template ID
  name: string;
  level: number;
  aggroRange: number;
  leashRange: number;
  lootTable: string;
  aiState: AIState;
  targetId: EntityId | null;
}

export enum AIState {
  IDLE = 0,
  PATROL = 1,
  CHASE = 2,
  ATTACK = 3,
  FLEE = 4,
  DEAD = 5,
}

// Inventory
export interface InventorySlot {
  slot: number;
  itemId: string;
  quantity: number;
  durability?: number;
  metadata?: Record<string, unknown>;
}

export interface EquipmentSlots {
  head?: InventorySlot;
  neck?: InventorySlot;
  shoulders?: InventorySlot;
  chest?: InventorySlot;
  waist?: InventorySlot;
  legs?: InventorySlot;
  feet?: InventorySlot;
  wrists?: InventorySlot;
  hands?: InventorySlot;
  finger1?: InventorySlot;
  finger2?: InventorySlot;
  trinket1?: InventorySlot;
  trinket2?: InventorySlot;
  mainHand?: InventorySlot;
  offHand?: InventorySlot;
  ranged?: InventorySlot;
}

// Skills
export interface Skill {
  skillId: string;
  level: number;
  currentCooldown: number;
  maxCooldown: number;
}

// Buffs/Debuffs
export interface Buff {
  buffId: string;
  stacks: number;
  remainingDuration: number;
  casterId: EntityId;
}

// Chunk
export interface ChunkData {
  chunkX: number;
  chunkY: number;
  tiles: Uint8Array; // Terrain type per tile
  entities: EntityId[]; // Entity IDs in this chunk
  heightMap?: Float32Array;
}

// Chat
export enum ChatChannel {
  SAY = 0,
  YELL = 1,
  PARTY = 2,
  GUILD = 3,
  WHISPER = 4,
  OFFICER = 5,
  TRADE = 6,
  GENERAL = 7,
  SYSTEM = 8,
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  channel: ChatChannel;
  senderId: EntityId;
  senderName: string;
  message: string;
  targetId?: EntityId; // For whispers
}

// Combat
export interface CombatLogEntry {
  timestamp: number;
  attackerId: EntityId;
  defenderId: EntityId;
  skillId: string;
  damage: number;
  healing: number;
  isCritical: boolean;
  isBlocked: boolean;
  isDodged: boolean;
  isAbsorbed: boolean;
}

// Party
export interface Party {
  id: string;
  leaderId: EntityId;
  members: PartyMember[];
  lootMethod: LootMethod;
  lootThreshold: number;
}

export interface PartyMember {
  entityId: EntityId;
  name: string;
  class: CharacterClass;
  level: number;
  health: Health;
  position: Vector3;
  isOnline: boolean;
}

export enum LootMethod {
  FREE_FOR_ALL = 0,
  ROUND_ROBIN = 1,
  MASTER_LOOTER = 2,
  GROUP_LOOT = 3,
  NEED_BEFORE_GREED = 4,
}

// Guild
export interface Guild {
  id: string;
  name: string;
  tag: string;
  leaderId: EntityId;
  members: GuildMember[];
  level: number;
  experience: number;
  bankGold: number;
}

export interface GuildMember {
  entityId: EntityId;
  name: string;
  class: CharacterClass;
  level: number;
  rank: GuildRank;
  joinedAt: number;
  lastOnline: number;
}

export enum GuildRank {
  GUILDMASTER = 0,
  OFFICER = 1,
  VETERAN = 2,
  MEMBER = 3,
  INITIATE = 4,
}

// Trade
export interface Trade {
  id: string;
  initiatorId: EntityId;
  targetId: EntityId;
  initiatorItems: TradeItem[];
  targetItems: TradeItem[];
  initiatorGold: number;
  targetGold: number;
  initiatorAccepted: boolean;
  targetAccepted: boolean;
  status: TradeStatus;
}

export interface TradeItem {
  slot: number;
  itemId: string;
  quantity: number;
}

export enum TradeStatus {
  PENDING = 0,
  ACCEPTED = 1,
  CANCELLED = 2,
  COMPLETED = 3,
  FAILED = 4,
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accountId: AccountId;
  characters: Character[];
}

export interface RegisterResponse {
  accessToken: string;
  refreshToken: string;
  accountId: AccountId;
  characters: Character[];
}

export interface CharacterSelectResponse {
  character: Character;
  gameServerUrl: string;
  sessionId: SessionId;
}

export interface CreateCharacterResponse {
  character: Character;
}

export interface CharacterListResponse {
  characters: Character[];
}

// WebSocket protocol types
export interface ClientHello {
  clientVersion: string;
  protocolVersion: number;
}

export interface ServerHello {
  serverVersion: string;
  serverTime: number;
  sessionId: SessionId;
}

export interface AuthChallenge {
  challenge: string;
  algorithm: string;
}

export interface AuthResponse {
  characterId: CharacterId;
  response: string;
}

export interface AuthSuccess {
  characterId: CharacterId;
  spawnPosition: Vector3;
  worldId: WorldId;
}

export interface AuthFailure {
  reason: string;
}

export interface EntityMove {
  entityId: EntityId;
  position: Vector3;
  velocity: Vector3;
  rotation: number;
}

export interface PlayerMove {
  position: Vector3;
  velocity: Vector3;
  rotation: number;
  inputFlags: number;
}

export interface ChunkLoad {
  chunkX: number;
  chunkY: number;
}

export interface ChunkUnload {
  chunkX: number;
  chunkY: number;
}

export interface VoiceJoin {
  roomId: string;
  token: string;
}

export interface VoiceLeave {
  roomId: string;
}

export interface VoiceSpeaking {
  entityId: EntityId;
  speaking: boolean;
  volume: number;
}

// Input flags (bitmask)
export const InputFlags = {
  MOVE_FORWARD: 1 << 0,
  MOVE_BACKWARD: 1 << 1,
  MOVE_LEFT: 1 << 2,
  MOVE_RIGHT: 1 << 3,
  JUMP: 1 << 4,
  SPRINT: 1 << 5,
  CROUCH: 1 << 6,
  ATTACK_PRIMARY: 1 << 7,
  ATTACK_SECONDARY: 1 << 8,
  INTERACT: 1 << 9,
  AUTO_RUN: 1 << 10,
} as const;

export type InputFlag = (typeof InputFlags)[keyof typeof InputFlags];