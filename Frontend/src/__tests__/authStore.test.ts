import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../store/authStore';
import type { Character, CharacterClass } from '../types/protocol';

describe('AuthStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      accountId: null,
      username: null,
      email: null,
      characters: [],
      selectedCharacter: null,
      gameServerUrl: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const mockCharacter: Character = {
    id: 'char-1',
    accountId: 'acc-1',
    name: 'TestHero',
    class: 0, // WARRIOR
    level: 10,
    experience: 5000,
    position: { x: 100, y: 64, z: 100 },
    health: { current: 100, max: 100 },
    stats: {
      strength: 15,
      agility: 10,
      intelligence: 8,
      vitality: 12,
      spirit: 10,
    },
    createdAt: Date.now() - 86400000,
    lastLoginAt: Date.now(),
  };

  describe('setAuth', () => {
    it('should set all auth data and mark as authenticated', () => {
      const { setAuth } = useAuthStore.getState();
      
      setAuth('access-token', 'refresh-token', 'acc-1', [mockCharacter]);
      
      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('access-token');
      expect(state.refreshToken).toBe('refresh-token');
      expect(state.accountId).toBe('acc-1');
      expect(state.characters).toEqual([mockCharacter]);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('setAccessToken', () => {
    it('should update access token and authentication status', () => {
      const { setAccessToken } = useAuthStore.getState();
      
      setAccessToken('new-token');
      expect(useAuthStore.getState().accessToken).toBe('new-token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      
      setAccessToken(null);
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('setCharacters', () => {
    it('should replace characters array', () => {
      const { setCharacters } = useAuthStore.getState();
      
      setCharacters([mockCharacter]);
      expect(useAuthStore.getState().characters).toEqual([mockCharacter]);
      
      const char2 = { ...mockCharacter, id: 'char-2', name: 'TestHero2' };
      setCharacters([mockCharacter, char2]);
      expect(useAuthStore.getState().characters).toHaveLength(2);
    });
  });

  describe('addCharacter', () => {
    it('should add character to existing list', () => {
      const { setCharacters, addCharacter } = useAuthStore.getState();
      
      setCharacters([mockCharacter]);
      const char2 = { ...mockCharacter, id: 'char-2', name: 'TestHero2' };
      
      addCharacter(char2);
      expect(useAuthStore.getState().characters).toHaveLength(2);
      expect(useAuthStore.getState().characters[1]).toEqual(char2);
    });
  });

  describe('removeCharacter', () => {
    it('should remove character by id', () => {
      const { setCharacters, removeCharacter } = useAuthStore.getState();
      
      const char2 = { ...mockCharacter, id: 'char-2', name: 'TestHero2' };
      setCharacters([mockCharacter, char2]);
      
      removeCharacter('char-1');
      expect(useAuthStore.getState().characters).toHaveLength(1);
      expect(useAuthStore.getState().characters[0].id).toBe('char-2');
    });

    it('should clear selected character if removed', () => {
      const { setCharacters, setSelectedCharacter, removeCharacter } = useAuthStore.getState();
      
      setCharacters([mockCharacter]);
      setSelectedCharacter(mockCharacter);
      
      removeCharacter('char-1');
      expect(useAuthStore.getState().selectedCharacter).toBeNull();
    });
  });

  describe('setSelectedCharacter', () => {
    it('should set selected character', () => {
      const { setSelectedCharacter } = useAuthStore.getState();
      
      setSelectedCharacter(mockCharacter);
      expect(useAuthStore.getState().selectedCharacter).toEqual(mockCharacter);
      
      setSelectedCharacter(null);
      expect(useAuthStore.getState().selectedCharacter).toBeNull();
    });
  });

  describe('setGameServerUrl', () => {
    it('should set game server URL', () => {
      const { setGameServerUrl } = useAuthStore.getState();
      
      setGameServerUrl('wss://game.example.com/ws');
      expect(useAuthStore.getState().gameServerUrl).toBe('wss://game.example.com/ws');
    });
  });

  describe('setLoading', () => {
    it('should set loading state', () => {
      const { setLoading } = useAuthStore.getState();
      
      setLoading(true);
      expect(useAuthStore.getState().isLoading).toBe(true);
      
      setLoading(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should set error and clear loading', () => {
      const { setError } = useAuthStore.getState();
      
      useAuthStore.getState().setLoading(true);
      setError('Invalid credentials');
      
      expect(useAuthStore.getState().error).toBe('Invalid credentials');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error', () => {
      const { setError, clearError } = useAuthStore.getState();
      
      setError('Some error');
      clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('logout', () => {
    it('should reset all auth state', () => {
      const { setAuth, logout } = useAuthStore.getState();
      
      setAuth('token', 'refresh', 'acc-1', [mockCharacter]);
      useAuthStore.getState().setSelectedCharacter(mockCharacter);
      useAuthStore.getState().setGameServerUrl('wss://game.example.com/ws');
      
      logout();
      
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.accountId).toBeNull();
      expect(state.username).toBeNull();
      expect(state.email).toBeNull();
      expect(state.characters).toEqual([]);
      expect(state.selectedCharacter).toBeNull();
      expect(state.gameServerUrl).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist to localStorage', () => {
      const { setAuth } = useAuthStore.getState();
      
      setAuth('token', 'refresh', 'acc-1', [mockCharacter]);
      
      // Check that localStorage.setItem was called with correct key
      expect(localStorage.setItem).toHaveBeenCalledWith('synapse-auth', expect.any(String));
    });

    it('should have correct persist configuration', () => {
      // Just verify the store has the persist middleware configured
      // The actual rehydration happens on app init
      const { setAuth } = useAuthStore.getState();
      setAuth('token', 'refresh', 'acc-1', [mockCharacter]);
      
      // Verify the data was passed to localStorage
      expect(localStorage.setItem).toHaveBeenCalled();
    });
  });
});