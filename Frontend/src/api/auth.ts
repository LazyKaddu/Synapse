import { apiClient } from './client';
import { useAuthStore } from '../store/authStore';
import type { Character, LoginResponse, RegisterResponse } from '../types/protocol';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  username: string;
}

export interface CharacterCreateData {
  name: string;
  classId: number;
}

export interface CharacterSelectData {
  characterId: string;
}

class AuthService {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await apiClient.login(credentials.email, credentials.password);
    const { accessToken, refreshToken, accountId, characters } = response;

    useAuthStore.getState().setAuth(accessToken, refreshToken, accountId, characters);
    return response;
  }

  async register(credentials: RegisterCredentials): Promise<RegisterResponse> {
    const response = await apiClient.register(credentials.email, credentials.password, credentials.username);
    const { accessToken, refreshToken, accountId, characters } = response;

    useAuthStore.getState().setAuth(accessToken, refreshToken, accountId, characters);
    return response;
  }

  async logout(): Promise<void> {
    try {
      await apiClient.logout();
    } finally {
      useAuthStore.getState().logout();
    }
  }

  async fetchCharacters(): Promise<Character[]> {
    const response = await apiClient.getCharacters();
    useAuthStore.getState().setCharacters(response.characters);
    return response.characters;
  }

  async createCharacter(data: CharacterCreateData): Promise<Character> {
    const response = await apiClient.createCharacter(data.name, data.classId);
    const characters = useAuthStore.getState().characters;
    useAuthStore.getState().setCharacters([...characters, response.character]);
    return response.character;
  }

  async selectCharacter(data: CharacterSelectData): Promise<{ character: Character; gameServerUrl: string }> {
    const response = await apiClient.selectCharacter(data.characterId);
    useAuthStore.getState().setSelectedCharacter(response.character);
    useAuthStore.getState().setGameServerUrl(response.gameServerUrl);
    return response;
  }

  getStoredAuth(): { accessToken: string | null; accountId: string | null } {
    const state = useAuthStore.getState();
    return {
      accessToken: state.accessToken,
      accountId: state.accountId,
    };
  }

  isAuthenticated(): boolean {
    return !!useAuthStore.getState().accessToken;
  }
}

export const authService = new AuthService();
export default authService;