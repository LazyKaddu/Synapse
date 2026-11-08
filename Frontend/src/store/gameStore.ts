import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Entity, Player, Monster, Vector2, Vector3 } from '../types/protocol';

interface GameState {
  // Connection
  connected: boolean;
  connecting: boolean;
  latency: number;
  
  // Player state
  player: Player | null;
  playerId: string | null;
  
  // World state
  currentChunk: { x: number; y: number } | null;
  loadedChunks: Set<string>;
  
  // Entities (neighbors)
  entities: Map<string, Entity>;
  players: Map<string, Player>;
  monsters: Map<string, Monster>;
  
  // Input state
  inputFlags: number;
  moveTarget: Vector2 | null;
  
  // Combat
  combatTarget: string | null;
  inCombat: boolean;
  
  // Chat
  messages: ChatMessage[];
  maxMessages: number;
  
  // UI state
  showMinimap: boolean;
  showChat: boolean;
  showInventory: boolean;
  showCharacter: boolean;
  
  // Actions
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setLatency: (latency: number) => void;
  
  setPlayer: (player: Player) => void;
  setPlayerId: (id: string) => void;
  updatePlayerPosition: (position: Vector3, velocity?: Vector3, rotation?: number) => void;
  updatePlayerHealth: (current: number, max: number) => void;
  updatePlayerStats: (stats: Partial<Player>) => void;
  
  setCurrentChunk: (chunk: { x: number; y: number }) => void;
  addLoadedChunk: (chunkKey: string) => void;
  removeLoadedChunk: (chunkKey: string) => void;
  
  // Entity management
  addEntity: (entity: Entity) => void;
  updateEntity: (entityId: string, updates: Partial<Entity>) => void;
  removeEntity: (entityId: string) => void;
  clearEntities: () => void;
  
  // Player-specific
  addPlayer: (player: Player) => void;
  updatePlayer: (playerId: string, updates: Partial<Player>) => void;
  removePlayer: (playerId: string) => void;
  
  // Monster-specific
  addMonster: (monster: Monster) => void;
  updateMonster: (monsterId: string, updates: Partial<Monster>) => void;
  removeMonster: (monsterId: string) => void;
  
  // Input
  setInputFlags: (flags: number) => void;
  setMoveTarget: (target: Vector2 | null) => void;
  
  // Combat
  setCombatTarget: (targetId: string | null) => void;
  setInCombat: (inCombat: boolean) => void;
  
  // Chat
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  
  // UI
  toggleMinimap: () => void;
  toggleChat: () => void;
  toggleInventory: () => void;
  toggleCharacter: () => void;
  
  // Reset
  reset: () => void;
}

export interface ChatMessage {
  id: string;
  timestamp: number;
  channel: number;
  senderId: string;
  senderName: string;
  message: string;
  isLocal: boolean;
}

const initialState = {
  connected: false,
  connecting: false,
  latency: 0,
  player: null,
  playerId: null,
  currentChunk: null,
  loadedChunks: new Set<string>(),
  entities: new Map<string, Entity>(),
  players: new Map<string, Player>(),
  monsters: new Map<string, Monster>(),
  inputFlags: 0,
  moveTarget: null,
  combatTarget: null,
  inCombat: false,
  messages: [],
  maxMessages: 100,
  showMinimap: true,
  showChat: false,
  showInventory: false,
  showCharacter: false,
};

export const useGameStore = create<GameState>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,

    // Connection
    setConnected: (connected) => set({ connected, connecting: false }),
    setConnecting: (connecting) => set({ connecting }),
    setLatency: (latency) => set({ latency }),

    // Player
    // Player
    setPlayer: (player) => set({ player, playerId: player.id, players: new Map([[player.id, player]]), entities: new Map([[player.id, player]]) }),
    setPlayerId: (id) => set({ playerId: id }),
    
    updatePlayerPosition: (position, velocity, rotation) =>
      set((state) => {
        if (!state.player) return state;
        return {
          player: {
            ...state.player,
            position,
            velocity: velocity ?? state.player.velocity,
            rotation: rotation ?? state.player.rotation,
          },
        };
      }),

    updatePlayerHealth: (current, max) =>
      set((state) => {
        if (!state.player) return state;
        return {
          player: {
            ...state.player,
            health: { current, max },
          },
        };
      }),

    updatePlayerStats: (stats) =>
      set((state) => {
        if (!state.player) return state;
        return { player: { ...state.player, ...stats } };
      }),

    // World
    setCurrentChunk: (chunk) => set({ currentChunk: chunk }),
    addLoadedChunk: (chunkKey) =>
      set((state) => {
        const newChunks = new Set(state.loadedChunks);
        newChunks.add(chunkKey);
        return { loadedChunks: newChunks };
      }),
    removeLoadedChunk: (chunkKey) =>
      set((state) => {
        const newChunks = new Set(state.loadedChunks);
        newChunks.delete(chunkKey);
        return { loadedChunks: newChunks };
      }),

    // Entities
    addEntity: (entity) =>
      set((state) => {
        const newEntities = new Map(state.entities);
        newEntities.set(entity.id, entity);
        return { entities: newEntities };
      }),

    updateEntity: (entityId, updates) =>
      set((state) => {
        const entity = state.entities.get(entityId);
        if (!entity) return state;
        const newEntities = new Map(state.entities);
        newEntities.set(entityId, { ...entity, ...updates });
        return { entities: newEntities };
      }),

    removeEntity: (entityId) =>
      set((state) => {
        const newEntities = new Map(state.entities);
        newEntities.delete(entityId);
        return { entities: newEntities };
      }),

    clearEntities: () => set({ entities: new Map(), players: new Map(), monsters: new Map() }),

    // Players
    addPlayer: (player) =>
      set((state) => {
        const newPlayers = new Map(state.players);
        newPlayers.set(player.id, player);
        const newEntities = new Map(state.entities);
        newEntities.set(player.id, player);
        return { players: newPlayers, entities: newEntities };
      }),

    updatePlayer: (playerId, updates) =>
      set((state) => {
        const player = state.players.get(playerId);
        if (!player) return state;
        const newPlayers = new Map(state.players);
        newPlayers.set(playerId, { ...player, ...updates });
        const newEntities = new Map(state.entities);
        newEntities.set(playerId, { ...player, ...updates });
        return { players: newPlayers, entities: newEntities };
      }),

    removePlayer: (playerId) =>
      set((state) => {
        const newPlayers = new Map(state.players);
        newPlayers.delete(playerId);
        const newEntities = new Map(state.entities);
        newEntities.delete(playerId);
        return { players: newPlayers, entities: newEntities };
      }),

    // Monsters
    addMonster: (monster) =>
      set((state) => {
        const newMonsters = new Map(state.monsters);
        newMonsters.set(monster.id, monster);
        const newEntities = new Map(state.entities);
        newEntities.set(monster.id, monster);
        return { monsters: newMonsters, entities: newEntities };
      }),

    updateMonster: (monsterId, updates) =>
      set((state) => {
        const monster = state.monsters.get(monsterId);
        if (!monster) return state;
        const newMonsters = new Map(state.monsters);
        newMonsters.set(monsterId, { ...monster, ...updates });
        const newEntities = new Map(state.entities);
        newEntities.set(monsterId, { ...monster, ...updates });
        return { monsters: newMonsters, entities: newEntities };
      }),

    removeMonster: (monsterId) =>
      set((state) => {
        const newMonsters = new Map(state.monsters);
        newMonsters.delete(monsterId);
        const newEntities = new Map(state.entities);
        newEntities.delete(monsterId);
        return { monsters: newMonsters, entities: newEntities };
      }),

    // Input
    setInputFlags: (flags) => set({ inputFlags: flags }),
    setMoveTarget: (target) => set({ moveTarget: target }),

    // Combat
    setCombatTarget: (targetId) => set({ combatTarget: targetId }),
    setInCombat: (inCombat) => set({ inCombat }),

    // Chat
    addMessage: (message) =>
      set((state) => {
        const newMessages = [...state.messages, message];
        if (newMessages.length > state.maxMessages) {
          newMessages.splice(0, newMessages.length - state.maxMessages);
        }
        return { messages: newMessages };
      }),

    clearMessages: () => set({ messages: [] }),

    // UI
    toggleMinimap: () => set((state) => ({ showMinimap: !state.showMinimap })),
    toggleChat: () => set((state) => ({ showChat: !state.showChat })),
    toggleInventory: () => set((state) => ({ showInventory: !state.showInventory })),
    toggleCharacter: () => set((state) => ({ showCharacter: !state.showCharacter })),

    // Reset
    reset: () => set(initialState),
  }))
);

// Selectors for performance
export const selectPlayer = () => useGameStore.getState().player;
export const selectEntities = () => useGameStore.getState().entities;
export const selectPlayers = () => useGameStore.getState().players;
export const selectMonsters = () => useGameStore.getState().monsters;
export const selectConnected = () => useGameStore.getState().connected;
export const selectLatency = () => useGameStore.getState().latency;
export const selectMessages = () => useGameStore.getState().messages;
export const selectCombatTarget = () => useGameStore.getState().combatTarget;

// Subscribe to player position changes for interpolation
export const subscribePlayerPosition = (callback: (position: { x: number; y: number; z: number }) => void) => {
  return useGameStore.subscribe(
    (state) => state.player?.position,
    (position) => {
      if (position) callback(position);
    },
    { equalityFn: (a, b) => a?.x === b?.x && a?.y === b?.y && a?.z === b?.z }
  );
};

// Subscribe to entity changes
export const subscribeEntities = (callback: (entities: Map<string, Entity>) => void) => {
  return useGameStore.subscribe(
    (state) => state.entities,
    (entities) => callback(entities),
    { equalityFn: (a, b) => a === b }
  );
};