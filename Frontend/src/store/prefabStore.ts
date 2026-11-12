import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export interface SavedPrefabEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorZ?: number;
  payloadBase64: string;
  byteLength?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SaveIntermediatePrefabInput {
  id?: string;
  name: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorZ?: number;
  payloadBase64: string;
  byteLength?: number;
}

export interface BackendPrefabSummary {
  id: number;
  name: string;
  width: number;
  height: number;
  anchor_x: number;
  anchor_y: number;
  anchor_z?: number;
  byte_length: number;
  created_at: string;
}

export interface ActivePlacementPrefab {
  prefabId: string;
  name: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorZ?: number;
  payloadBase64: string;
}

export interface PlacedWorldPrefab {
  id: string;
  prefabId: string;
  name: string;
  worldX: number;
  worldY: number;
  anchorZ?: number;
  placedAt: number;
  payloadBase64?: string;
}

export interface RecordPlacedWorldPrefabInput {
  id?: string;
  prefabId: string;
  name: string;
  worldX: number;
  worldY: number;
  anchorZ?: number;
  placedAt?: number;
  payloadBase64?: string;
}

export interface PrefabState {
  isEditorOpen: boolean;
  intermediatePrefabs: SavedPrefabEntry[];
  backendPrefabs: BackendPrefabSummary[];
  activePlacement: ActivePlacementPrefab | null;
  placedWorldPrefabs: PlacedWorldPrefab[];

  openEditor: () => void;
  closeEditor: () => void;
  saveIntermediatePrefab: (input: SaveIntermediatePrefabInput) => SavedPrefabEntry;
  deleteIntermediatePrefab: (id: string) => void;
  setBackendPrefabs: (prefabs: BackendPrefabSummary[]) => void;
  upsertBackendPrefab: (prefab: BackendPrefabSummary) => void;
  removeBackendPrefab: (id: number) => void;
  startWorldPlacement: (placement: ActivePlacementPrefab) => void;
  setActivePlacementAnchorZ: (anchorZ: number) => void;
  cancelWorldPlacement: () => void;
  recordPlacedWorldPrefab: (input: RecordPlacedWorldPrefabInput) => PlacedWorldPrefab;
  clearPlacedWorldPrefabs: () => void;
  reset: () => void;
}

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function resolveLocalStorage(): StateStorage {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
  } catch {
    // Ignore SecurityError or unavailable localStorage in restricted contexts
  }
  return noopStorage;
}

const safeLocalStorage: StateStorage = {
  getItem: (name) => resolveLocalStorage().getItem(name),
  setItem: (name, value) => resolveLocalStorage().setItem(name, value),
  removeItem: (name) => resolveLocalStorage().removeItem(name),
};

function generateId(prefix: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const initialState = {
  isEditorOpen: false,
  intermediatePrefabs: [] as SavedPrefabEntry[],
  backendPrefabs: [] as BackendPrefabSummary[],
  activePlacement: null as ActivePlacementPrefab | null,
  placedWorldPrefabs: [] as PlacedWorldPrefab[],
};

export const usePrefabStore = create<PrefabState>()(
  persist(
    (set, get) => ({
      ...initialState,

      openEditor: () => set({ isEditorOpen: true }),

      closeEditor: () => set({ isEditorOpen: false }),

      saveIntermediatePrefab: (input) => {
        const now = Date.now();
        const existingList = get().intermediatePrefabs;
        const existing = input.id
          ? existingList.find((item) => item.id === input.id)
          : undefined;

        const entry: SavedPrefabEntry = {
          id: existing?.id ?? input.id ?? generateId('prefab'),
          name: input.name,
          width: input.width,
          height: input.height,
          anchorX: input.anchorX,
          anchorY: input.anchorY,
          ...(input.anchorZ !== undefined ? { anchorZ: input.anchorZ } : {}),
          payloadBase64: input.payloadBase64,
          ...(input.byteLength !== undefined ? { byteLength: input.byteLength } : {}),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        set((state) => {
          const index = state.intermediatePrefabs.findIndex((item) => item.id === entry.id);
          if (index >= 0) {
            const next = [...state.intermediatePrefabs];
            next[index] = entry;
            return { intermediatePrefabs: next };
          }
          return { intermediatePrefabs: [entry, ...state.intermediatePrefabs] };
        });

        return entry;
      },

      deleteIntermediatePrefab: (id) =>
        set((state) => ({
          intermediatePrefabs: state.intermediatePrefabs.filter((item) => item.id !== id),
          activePlacement:
            state.activePlacement?.prefabId === id ? null : state.activePlacement,
        })),

      setBackendPrefabs: (prefabs) => set({ backendPrefabs: prefabs }),

      upsertBackendPrefab: (prefab) =>
        set((state) => {
          const index = state.backendPrefabs.findIndex((item) => item.id === prefab.id);
          if (index >= 0) {
            const next = [...state.backendPrefabs];
            next[index] = prefab;
            return { backendPrefabs: next };
          }
          return { backendPrefabs: [prefab, ...state.backendPrefabs] };
        }),

      removeBackendPrefab: (id) =>
        set((state) => ({
          backendPrefabs: state.backendPrefabs.filter((item) => item.id !== id),
          activePlacement:
            state.activePlacement?.prefabId === `backend:${id}` ||
            state.activePlacement?.prefabId === String(id)
              ? null
              : state.activePlacement,
        })),

      startWorldPlacement: (placement) =>
        set({
          activePlacement: {
            prefabId: placement.prefabId,
            name: placement.name,
            width: placement.width,
            height: placement.height,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
            ...(placement.anchorZ !== undefined ? { anchorZ: placement.anchorZ } : {}),
            payloadBase64: placement.payloadBase64,
          },
        }),

      setActivePlacementAnchorZ: (anchorZ) =>
        set((state) => {
          if (!state.activePlacement) return state;
          const clamped = Math.max(-32768, Math.min(32767, Math.trunc(anchorZ)));
          return {
            activePlacement: {
              ...state.activePlacement,
              anchorZ: clamped,
            },
          };
        }),

      cancelWorldPlacement: () => set({ activePlacement: null }),

      recordPlacedWorldPrefab: (input) => {
        const entry: PlacedWorldPrefab = {
          id: input.id ?? generateId('placed'),
          prefabId: input.prefabId,
          name: input.name,
          worldX: input.worldX,
          worldY: input.worldY,
          ...(input.anchorZ !== undefined ? { anchorZ: input.anchorZ } : {}),
          placedAt: input.placedAt ?? Date.now(),
          ...(input.payloadBase64 !== undefined ? { payloadBase64: input.payloadBase64 } : {}),
        };

        set((state) => ({
          placedWorldPrefabs: [...state.placedWorldPrefabs, entry],
        }));

        return entry;
      },

      clearPlacedWorldPrefabs: () => set({ placedWorldPrefabs: [] }),

      reset: () => set({ ...initialState }),
    }),
    {
      name: 'synapse-prefabs',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        intermediatePrefabs: state.intermediatePrefabs,
        placedWorldPrefabs: state.placedWorldPrefabs,
      }),
    }
  )
);
