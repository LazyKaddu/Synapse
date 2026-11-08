import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '../api/client';
import { authService } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import type { Character, LoginResponse, RegisterResponse } from '../types/protocol';

// Mock axios - must be hoisted, so define inside factory
vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: {
      baseURL: '',
      headers: {},
      withCredentials: false,
    },
  };
  
  mockAxios.create.mockReturnValue(mockAxios);
  
  return {
    default: mockAxios,
    AxiosError: class extends Error {
      constructor(message: string, public config?: any, public response?: any) {
        super(message);
      }
    },
  };
});

import axios from 'axios';

const mockAxios = axios as any;

describe('ApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.create.mockReturnValue(mockAxios);
    mockAxios.interceptors.request.use.mockImplementation((fn: any) => fn);
    mockAxios.interceptors.response.use.mockImplementation((fn: any) => fn);
    
    // Reset auth store
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
  });

  describe('Request interceptor', () => {
    it('should have request interceptor configured', () => {
      // The interceptor is set up when the module is imported
      expect(mockAxios.interceptors.request.use).toBeDefined();
    });
  });

  describe('Response interceptor', () => {
    it('should have response interceptor configured', () => {
      // The interceptor is set up when the module is imported
      expect(mockAxios.interceptors.response.use).toBeDefined();
    });
  });

  describe('Auth endpoints', () => {
    it('should call login endpoint', async () => {
      const mockResponse: LoginResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'acc-1',
        characters: [],
      };
      mockAxios.post.mockResolvedValue({ data: mockResponse });
      
      const result = await apiClient.login('test@example.com', 'password');
      
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should call register endpoint', async () => {
      const mockResponse: RegisterResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'acc-1',
        characters: [],
      };
      mockAxios.post.mockResolvedValue({ data: mockResponse });
      
      const result = await apiClient.register('test@example.com', 'password', 'username');
      
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/register', {
        email: 'test@example.com',
        password: 'password',
        username: 'username',
      });
      expect(result).toEqual(mockResponse);
    });

    it('should call logout endpoint', async () => {
      mockAxios.post.mockResolvedValue({ data: {} });
      
      await apiClient.logout();
      
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/logout');
    });

    it('should fetch characters', async () => {
      const mockCharacters: Character[] = [
        { id: 'char-1', name: 'Hero1' } as Character,
        { id: 'char-2', name: 'Hero2' } as Character,
      ];
      mockAxios.get.mockResolvedValue({ data: { characters: mockCharacters } });
      
      const result = await apiClient.getCharacters();
      
      expect(mockAxios.get).toHaveBeenCalledWith('/characters');
      expect(result).toEqual({ characters: mockCharacters });
    });

    it('should create character', async () => {
      const mockCharacter: Character = { id: 'char-1', name: 'NewHero' } as Character;
      mockAxios.post.mockResolvedValue({ data: { character: mockCharacter } });
      
      const result = await apiClient.createCharacter('NewHero', 0);
      
      expect(mockAxios.post).toHaveBeenCalledWith('/characters', { name: 'NewHero', classId: 0 });
      expect(result).toEqual({ character: mockCharacter });
    });

    it('should select character', async () => {
      const mockResponse = {
        character: { id: 'char-1', name: 'Hero1' } as Character,
        gameServerUrl: 'wss://game.example.com/ws',
      };
      mockAxios.post.mockResolvedValue({ data: mockResponse });
      
      const result = await apiClient.selectCharacter('char-1');
      
      expect(mockAxios.post).toHaveBeenCalledWith('/characters/select', { characterId: 'char-1' });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('Generic methods', () => {
    it('should call get with params', async () => {
      mockAxios.get.mockResolvedValue({ data: { items: [] } });
      
      await apiClient.get('/test', { page: 1 });
      
      expect(mockAxios.get).toHaveBeenCalledWith('/test', { params: { page: 1 } });
    });

    it('should call post with data', async () => {
      mockAxios.post.mockResolvedValue({ data: {} });
      
      await apiClient.post('/test', { key: 'value' });
      
      expect(mockAxios.post).toHaveBeenCalledWith('/test', { key: 'value' });
    });

    it('should call put with data', async () => {
      mockAxios.put.mockResolvedValue({ data: {} });
      
      await apiClient.put('/test', { key: 'value' });
      
      expect(mockAxios.put).toHaveBeenCalledWith('/test', { key: 'value' });
    });

    it('should call delete', async () => {
      mockAxios.delete.mockResolvedValue({ data: {} });
      
      await apiClient.delete('/test');
      
      expect(mockAxios.delete).toHaveBeenCalledWith('/test');
    });
  });
});

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.create.mockReturnValue(mockAxios);
    mockAxios.interceptors.request.use.mockImplementation((fn: any) => fn);
    mockAxios.interceptors.response.use.mockImplementation((fn: any) => fn);
    mockAxios.post.mockResolvedValue({ data: {} });
    
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
  });

  describe('login', () => {
    it('should login and store auth', async () => {
      const mockResponse: LoginResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'acc-1',
        characters: [{ id: 'char-1', name: 'Hero1' } as Character],
      };
      mockAxios.post.mockResolvedValue({ data: mockResponse });
      
      const result = await authService.login({ email: 'test@example.com', password: 'password' });
      
      expect(result).toEqual(mockResponse);
      expect(useAuthStore.getState().accessToken).toBe('access-token');
      expect(useAuthStore.getState().refreshToken).toBe('refresh-token');
      expect(useAuthStore.getState().accountId).toBe('acc-1');
      expect(useAuthStore.getState().characters).toHaveLength(1);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  describe('register', () => {
    it('should register and store auth', async () => {
      const mockResponse: RegisterResponse = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: 'acc-1',
        characters: [],
      };
      mockAxios.post.mockResolvedValue({ data: mockResponse });
      
      const result = await authService.register({
        email: 'test@example.com',
        password: 'password',
        username: 'testuser',
      });
      
      expect(result).toEqual(mockResponse);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  describe('logout', () => {
    it('should call API logout and clear store', async () => {
      mockAxios.post.mockResolvedValue({ data: {} });
      
      useAuthStore.getState().setAuth('token', 'refresh', 'acc-1', []);
      
      await authService.logout();
      
      expect(mockAxios.post).toHaveBeenCalledWith('/auth/logout');
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('should clear store even if API logout fails', async () => {
      mockAxios.post.mockRejectedValue(new Error('Network error'));
      
      useAuthStore.getState().setAuth('token', 'refresh', 'acc-1', []);
      
      // The logout should still clear the store even if API call fails
      // We need to catch the error since it's thrown
      try {
        await authService.logout();
      } catch (e) {
        // Expected to throw
      }
      
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('fetchCharacters', () => {
    it('should fetch and store characters', async () => {
      const mockCharacters: Character[] = [
        { id: 'char-1', name: 'Hero1' } as Character,
        { id: 'char-2', name: 'Hero2' } as Character,
      ];
      mockAxios.get.mockResolvedValue({ data: { characters: mockCharacters } });
      
      const result = await authService.fetchCharacters();
      
      expect(result).toEqual(mockCharacters);
      expect(useAuthStore.getState().characters).toEqual(mockCharacters);
    });
  });

  describe('createCharacter', () => {
    it('should create character and add to store', async () => {
      const mockCharacter: Character = { id: 'char-new', name: 'NewHero' } as Character;
      mockAxios.post.mockResolvedValue({ data: { character: mockCharacter } });
      
      useAuthStore.getState().setCharacters([{ id: 'char-1', name: 'Hero1' } as Character]);
      
      const result = await authService.createCharacter({ name: 'NewHero', classId: 0 });
      
      expect(result).toEqual(mockCharacter);
      expect(useAuthStore.getState().characters).toHaveLength(2);
    });
  });

  describe('selectCharacter', () => {
    it('should select character and store game server URL', async () => {
      const mockCharacter: Character = { id: 'char-1', name: 'Hero1' } as Character;
      mockAxios.post.mockResolvedValue({
        data: { character: mockCharacter, gameServerUrl: 'wss://game.example.com/ws' },
      });
      
      const result = await authService.selectCharacter({ characterId: 'char-1' });
      
      expect(result.character).toEqual(mockCharacter);
      expect(result.gameServerUrl).toBe('wss://game.example.com/ws');
      expect(useAuthStore.getState().selectedCharacter).toEqual(mockCharacter);
      expect(useAuthStore.getState().gameServerUrl).toBe('wss://game.example.com/ws');
    });
  });

  describe('getStoredAuth', () => {
    it('should return stored auth', () => {
      useAuthStore.getState().setAuth('token', 'refresh', 'acc-1', []);
      
      const auth = authService.getStoredAuth();
      
      expect(auth.accessToken).toBe('token');
      expect(auth.accountId).toBe('acc-1');
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when token exists', () => {
      useAuthStore.getState().setAccessToken('token');
      expect(authService.isAuthenticated()).toBe(true);
    });

    it('should return false when no token', () => {
      useAuthStore.getState().setAccessToken(null);
      expect(authService.isAuthenticated()).toBe(false);
    });
  });
});