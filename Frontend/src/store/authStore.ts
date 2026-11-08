import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Character } from '../types/protocol';

interface AuthState {
  // Auth tokens
  accessToken: string | null;
  refreshToken: string | null;
  
  // Account info
  accountId: string | null;
  username: string | null;
  email: string | null;
  
  // Characters
  characters: Character[];
  selectedCharacter: Character | null;
  
  // Game server connection
  gameServerUrl: string | null;
  
  // Connection status
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setAuth: (accessToken: string, refreshToken: string, accountId: string, characters: Character[]) => void;
  setAccessToken: (token: string) => void;
  setRefreshToken: (token: string) => void;
  setAccountInfo: (accountId: string, username: string, email: string) => void;
  setCharacters: (characters: Character[]) => void;
  addCharacter: (character: Character) => void;
  removeCharacter: (characterId: string) => void;
  setSelectedCharacter: (character: Character | null) => void;
  setGameServerUrl: (url: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
  clearError: () => void;
}

const initialState = {
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
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setAuth: (accessToken, refreshToken, accountId, characters) =>
        set({
          accessToken,
          refreshToken,
          accountId,
          characters,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        }),

      setAccessToken: (token) =>
        set({ accessToken: token, isAuthenticated: !!token }),

      setRefreshToken: (token) =>
        set({ refreshToken: token }),

      setAccountInfo: (accountId, username, email) =>
        set({ accountId, username, email }),

      setCharacters: (characters) =>
        set({ characters }),

      addCharacter: (character) =>
        set((state) => ({
          characters: [...state.characters, character],
        })),

      removeCharacter: (characterId) =>
        set((state) => ({
          characters: state.characters.filter((c) => c.id !== characterId),
          selectedCharacter:
            state.selectedCharacter?.id === characterId ? null : state.selectedCharacter,
        })),

      setSelectedCharacter: (character) =>
        set({ selectedCharacter: character }),

      setGameServerUrl: (url) =>
        set({ gameServerUrl: url }),

      setLoading: (isLoading) =>
        set({ isLoading }),

      setError: (error) =>
        set({ error, isLoading: false }),

      logout: () =>
        set({
          ...initialState,
          // Keep persist middleware from clearing these on logout
          // They'll be cleared by the persist rehydration
        }),

      clearError: () =>
        set({ error: null }),
    }),
    {
      name: 'synapse-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        accountId: state.accountId,
        username: state.username,
        email: state.email,
        characters: state.characters,
        selectedCharacter: state.selectedCharacter,
        gameServerUrl: state.gameServerUrl,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isAuthenticated = !!state.accessToken;
        }
      },
    }
  )
);

// Selectors for common use cases
export const selectAuth = () => useAuthStore.getState();
export const selectAccessToken = () => useAuthStore.getState().accessToken;
export const selectSelectedCharacter = () => useAuthStore.getState().selectedCharacter;
export const selectGameServerUrl = () => useAuthStore.getState().gameServerUrl;
export const selectIsAuthenticated = () => useAuthStore.getState().isAuthenticated;