import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Player, Monster, Entity, Vector3, Vector2 } from '../types/protocol';

describe('GameStore', () => {
  beforeEach(() => {
    useGameStore.setState({
      connected: false,
      connecting: false,
      latency: 0,
      player: null,
      playerId: null,
      currentChunk: null,
      loadedChunks: new Set(),
      entities: new Map(),
      players: new Map(),
      monsters: new Map(),
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
    });
  });

  const mockPlayer: Player = {
    id: 'player-1',
    entityType: 0, // PLAYER
    accountId: 'acc-1',
    characterId: 'char-1',
    name: 'TestPlayer',
    class: 0, // WARRIOR
    level: 10,
    experience: 5000,
    position: { x: 100, y: 64, z: 100 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: 0,
    health: { current: 100, max: 100 },
    stats: {
      strength: 15,
      agility: 10,
      intelligence: 8,
      vitality: 12,
      spirit: 10,
    },
    mana: { current: 50, max: 50 },
    stamina: { current: 100, max: 100 },
    inventory: [],
    equipment: {},
    skills: [],
    buffs: [],
    metadata: {},
  };

  const mockMonster: Monster = {
    id: 'monster-1',
    entityType: 1, // MONSTER
    monsterId: 'goblin',
    name: 'Goblin',
    level: 5,
    position: { x: 110, y: 64, z: 105 },
    velocity: { x: 0, y: 0, z: 0 },
    rotation: 0,
    health: { current: 50, max: 50 },
    aggroRange: 20,
    leashRange: 50,
    lootTable: 'goblin_loot',
    aiState: 0, // IDLE
    targetId: null,
    metadata: {},
  };

  describe('Connection state', () => {
    it('should set connected state', () => {
      const { setConnected } = useGameStore.getState();
      
      setConnected(true);
      expect(useGameStore.getState().connected).toBe(true);
      expect(useGameStore.getState().connecting).toBe(false);
      
      setConnected(false);
      expect(useGameStore.getState().connected).toBe(false);
    });

    it('should set connecting state', () => {
      const { setConnecting } = useGameStore.getState();
      
      setConnecting(true);
      expect(useGameStore.getState().connecting).toBe(true);
    });

    it('should set latency', () => {
      const { setLatency } = useGameStore.getState();
      
      setLatency(50);
      expect(useGameStore.getState().latency).toBe(50);
    });
  });

  describe('Player management', () => {
    it('should set player', () => {
      const { setPlayer } = useGameStore.getState();
      
      setPlayer(mockPlayer);
      
      expect(useGameStore.getState().player).toEqual(mockPlayer);
      expect(useGameStore.getState().playerId).toBe('player-1');
      expect(useGameStore.getState().players.get('player-1')).toEqual(mockPlayer);
      expect(useGameStore.getState().entities.get('player-1')).toEqual(mockPlayer);
    });

    it('should update player position', () => {
      const { setPlayer, updatePlayerPosition } = useGameStore.getState();
      
      setPlayer(mockPlayer);
      updatePlayerPosition({ x: 200, y: 64, z: 200 }, { x: 5, y: 0, z: 3 }, 1.57);
      
      const player = useGameStore.getState().player!;
      expect(player.position).toEqual({ x: 200, y: 64, z: 200 });
      expect(player.velocity).toEqual({ x: 5, y: 0, z: 3 });
      expect(player.rotation).toBe(1.57);
    });

    it('should update player health', () => {
      const { setPlayer, updatePlayerHealth } = useGameStore.getState();
      
      setPlayer(mockPlayer);
      updatePlayerHealth(75, 100);
      
      expect(useGameStore.getState().player!.health).toEqual({ current: 75, max: 100 });
    });

    it('should update player stats', () => {
      const { setPlayer, updatePlayerStats } = useGameStore.getState();
      
      setPlayer(mockPlayer);
      updatePlayerStats({ level: 11, experience: 6000 });
      
      expect(useGameStore.getState().player!.level).toBe(11);
      expect(useGameStore.getState().player!.experience).toBe(6000);
      // Other stats should remain
      expect(useGameStore.getState().player!.name).toBe('TestPlayer');
    });
  });

  describe('World/Chunk management', () => {
    it('should set current chunk', () => {
      const { setCurrentChunk } = useGameStore.getState();
      
      setCurrentChunk({ x: 5, y: 3 });
      expect(useGameStore.getState().currentChunk).toEqual({ x: 5, y: 3 });
    });

    it('should add and remove loaded chunks', () => {
      const { addLoadedChunk, removeLoadedChunk } = useGameStore.getState();
      
      addLoadedChunk('5,3');
      addLoadedChunk('5,4');
      expect(useGameStore.getState().loadedChunks.size).toBe(2);
      expect(useGameStore.getState().loadedChunks.has('5,3')).toBe(true);
      
      removeLoadedChunk('5,3');
      expect(useGameStore.getState().loadedChunks.size).toBe(1);
      expect(useGameStore.getState().loadedChunks.has('5,3')).toBe(false);
    });
  });

  describe('Entity management', () => {
    it('should add entity', () => {
      const { addEntity } = useGameStore.getState();
      
      addEntity(mockPlayer);
      
      expect(useGameStore.getState().entities.get('player-1')).toEqual(mockPlayer);
    });

    it('should update entity', () => {
      const { addEntity, updateEntity } = useGameStore.getState();
      
      addEntity(mockPlayer);
      updateEntity('player-1', { health: { current: 50, max: 100 } });
      
      expect(useGameStore.getState().entities.get('player-1')!.health.current).toBe(50);
    });

    it('should remove entity', () => {
      const { addEntity, removeEntity } = useGameStore.getState();
      
      addEntity(mockPlayer);
      removeEntity('player-1');
      
      expect(useGameStore.getState().entities.has('player-1')).toBe(false);
    });

    it('should clear all entities', () => {
      const { addEntity, clearEntities } = useGameStore.getState();
      
      addEntity(mockPlayer);
      addEntity(mockMonster);
      clearEntities();
      
      expect(useGameStore.getState().entities.size).toBe(0);
      expect(useGameStore.getState().players.size).toBe(0);
      expect(useGameStore.getState().monsters.size).toBe(0);
    });
  });

  describe('Player-specific management', () => {
    it('should add player', () => {
      const { addPlayer } = useGameStore.getState();
      
      addPlayer(mockPlayer);
      
      expect(useGameStore.getState().players.get('player-1')).toEqual(mockPlayer);
      expect(useGameStore.getState().entities.get('player-1')).toEqual(mockPlayer);
    });

    it('should update player', () => {
      const { addPlayer, updatePlayer } = useGameStore.getState();
      
      addPlayer(mockPlayer);
      updatePlayer('player-1', { position: { x: 150, y: 64, z: 150 } });
      
      expect(useGameStore.getState().players.get('player-1')!.position.x).toBe(150);
      expect(useGameStore.getState().entities.get('player-1')!.position.x).toBe(150);
    });

    it('should remove player', () => {
      const { addPlayer, removePlayer } = useGameStore.getState();
      
      addPlayer(mockPlayer);
      removePlayer('player-1');
      
      expect(useGameStore.getState().players.has('player-1')).toBe(false);
      expect(useGameStore.getState().entities.has('player-1')).toBe(false);
    });
  });

  describe('Monster-specific management', () => {
    it('should add monster', () => {
      const { addMonster } = useGameStore.getState();
      
      addMonster(mockMonster);
      
      expect(useGameStore.getState().monsters.get('monster-1')).toEqual(mockMonster);
      expect(useGameStore.getState().entities.get('monster-1')).toEqual(mockMonster);
    });

    it('should update monster', () => {
      const { addMonster, updateMonster } = useGameStore.getState();
      
      addMonster(mockMonster);
      updateMonster('monster-1', { health: { current: 25, max: 50 }, aiState: 2 });
      
      expect(useGameStore.getState().monsters.get('monster-1')!.health.current).toBe(25);
      expect(useGameStore.getState().monsters.get('monster-1')!.aiState).toBe(2);
    });

    it('should remove monster', () => {
      const { addMonster, removeMonster } = useGameStore.getState();
      
      addMonster(mockMonster);
      removeMonster('monster-1');
      
      expect(useGameStore.getState().monsters.has('monster-1')).toBe(false);
      expect(useGameStore.getState().entities.has('monster-1')).toBe(false);
    });
  });

  describe('Input management', () => {
    it('should set input flags', () => {
      const { setInputFlags } = useGameStore.getState();
      
      setInputFlags(5); // Forward + Right
      expect(useGameStore.getState().inputFlags).toBe(5);
    });

    it('should set move target', () => {
      const { setMoveTarget } = useGameStore.getState();
      
      setMoveTarget({ x: 200, y: 200 });
      expect(useGameStore.getState().moveTarget).toEqual({ x: 200, y: 200 });
      
      setMoveTarget(null);
      expect(useGameStore.getState().moveTarget).toBeNull();
    });
  });

  describe('Combat management', () => {
    it('should set combat target', () => {
      const { setCombatTarget } = useGameStore.getState();
      
      setCombatTarget('monster-1');
      expect(useGameStore.getState().combatTarget).toBe('monster-1');
      
      setCombatTarget(null);
      expect(useGameStore.getState().combatTarget).toBeNull();
    });

    it('should set in combat state', () => {
      const { setInCombat } = useGameStore.getState();
      
      setInCombat(true);
      expect(useGameStore.getState().inCombat).toBe(true);
      
      setInCombat(false);
      expect(useGameStore.getState().inCombat).toBe(false);
    });
  });

  describe('Chat management', () => {
    it('should add message', () => {
      const { addMessage } = useGameStore.getState();
      
      const message = {
        id: 'msg-1',
        timestamp: Date.now(),
        channel: 0,
        senderId: 'player-1',
        senderName: 'TestPlayer',
        message: 'Hello!',
        isLocal: true,
      };
      
      addMessage(message);
      
      expect(useGameStore.getState().messages).toHaveLength(1);
      expect(useGameStore.getState().messages[0]).toEqual(message);
    });

    it('should limit messages to maxMessages', () => {
      const { addMessage } = useGameStore.getState();
      
      // Add 105 messages (max is 100)
      for (let i = 0; i < 105; i++) {
        addMessage({
          id: `msg-${i}`,
          timestamp: Date.now(),
          channel: 0,
          senderId: 'player-1',
          senderName: 'TestPlayer',
          message: `Message ${i}`,
          isLocal: true,
        });
      }
      
      expect(useGameStore.getState().messages).toHaveLength(100);
      // Should keep the last 100
      expect(useGameStore.getState().messages[0].message).toBe('Message 5');
      expect(useGameStore.getState().messages[99].message).toBe('Message 104');
    });

    it('should clear messages', () => {
      const { addMessage, clearMessages } = useGameStore.getState();
      
      addMessage({
        id: 'msg-1',
        timestamp: Date.now(),
        channel: 0,
        senderId: 'player-1',
        senderName: 'TestPlayer',
        message: 'Hello!',
        isLocal: true,
      });
      
      clearMessages();
      expect(useGameStore.getState().messages).toHaveLength(0);
    });
  });

  describe('UI toggles', () => {
    it('should toggle minimap', () => {
      const { toggleMinimap } = useGameStore.getState();
      
      expect(useGameStore.getState().showMinimap).toBe(true);
      toggleMinimap();
      expect(useGameStore.getState().showMinimap).toBe(false);
      toggleMinimap();
      expect(useGameStore.getState().showMinimap).toBe(true);
    });

    it('should toggle chat', () => {
      const { toggleChat } = useGameStore.getState();
      
      expect(useGameStore.getState().showChat).toBe(false);
      toggleChat();
      expect(useGameStore.getState().showChat).toBe(true);
    });

    it('should toggle inventory', () => {
      const { toggleInventory } = useGameStore.getState();
      
      expect(useGameStore.getState().showInventory).toBe(false);
      toggleInventory();
      expect(useGameStore.getState().showInventory).toBe(true);
    });

    it('should toggle character', () => {
      const { toggleCharacter } = useGameStore.getState();
      
      expect(useGameStore.getState().showCharacter).toBe(false);
      toggleCharacter();
      expect(useGameStore.getState().showCharacter).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should reset to initial state', () => {
      const { setPlayer, setConnected, reset } = useGameStore.getState();
      
      setConnected(true);
      setPlayer(mockPlayer);
      
      reset();
      
      const state = useGameStore.getState();
      expect(state.connected).toBe(false);
      expect(state.player).toBeNull();
      expect(state.playerId).toBeNull();
      expect(state.entities.size).toBe(0);
    });
  });
});