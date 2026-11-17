/**
 * Teleport Store (Zustand).
 * Manages modal dialog visibility, active navigation tabs, flash screen feedback,
 * toast status messages, and online friend filtering for teleporter actions.
 */

import { create } from 'zustand';
import type { FriendDto } from './socialStore.ts';

export type TeleportTab = 'landmarks' | 'coordinates' | 'friends' | 'saved';
export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastInfo {
  message: string;
  type: ToastType;
}

export interface SavedCoordinate {
  id: string;
  name: string;
  x: number;
  y: number;
  createdAt: number;
}

export interface TeleportState {
  isOpen: boolean;
  activeTab: TeleportTab;
  flashActive: boolean;
  toast: ToastInfo | null;
  toastMessage: string | null;
  toastType: ToastType;
  savedLocations: SavedCoordinate[];

  // Modal actions
  openModal: () => void;
  closeModal: () => void;
  toggleModal: () => void;

  // Tab action
  setActiveTab: (tab: TeleportTab) => void;

  // Screen Flash effect
  triggerFlash: (durationMs?: number) => void;

  // Toast notification actions
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  clearToast: () => void;

  // Saved location management
  addSavedLocation: (name: string, x: number, y: number) => void;
  removeSavedLocation: (id: string) => void;
}

/**
 * Filters a list of friends to only those currently online and eligible for teleportation.
 */
export function filterOnlineFriends(friends: readonly FriendDto[] | null | undefined): FriendDto[] {
  if (!friends || !Array.isArray(friends)) return [];
  return friends.filter((f) => f && f.is_online === true);
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useTeleportStore = create<TeleportState>((set) => ({
  isOpen: false,
  activeTab: 'landmarks',
  flashActive: false,
  toast: null,
  toastMessage: null,
  toastType: 'info',
  savedLocations: [],

  openModal: () => {
    set({ isOpen: true });
  },

  closeModal: () => {
    set({ isOpen: false });
  },

  toggleModal: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  setActiveTab: (tab: TeleportTab) => {
    set({ activeTab: tab });
  },

  triggerFlash: (durationMs: number = 300) => {
    if (flashTimer) {
      clearTimeout(flashTimer);
    }
    set({ flashActive: true });
    if (typeof setTimeout !== 'undefined') {
      flashTimer = setTimeout(() => {
        set({ flashActive: false });
        flashTimer = null;
      }, durationMs);
    }
  },

  showToast: (message: string, type: ToastType = 'info', durationMs: number = 3000) => {
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    set({
      toast: { message, type },
      toastMessage: message,
      toastType: type,
    });
    if (typeof setTimeout !== 'undefined') {
      toastTimer = setTimeout(() => {
        set({ toast: null, toastMessage: null });
        toastTimer = null;
      }, durationMs);
    }
  },

  clearToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({ toast: null, toastMessage: null, toastType: 'info' });
  },

  addSavedLocation: (name: string, x: number, y: number) => {
    const newLoc: SavedCoordinate = {
      id: `loc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || `Location (${Math.round(x)}, ${Math.round(y)})`,
      x,
      y,
      createdAt: Date.now(),
    };
    set((state) => ({
      savedLocations: [newLoc, ...state.savedLocations],
    }));
  },

  removeSavedLocation: (id: string) => {
    set((state) => ({
      savedLocations: state.savedLocations.filter((loc) => loc.id !== id),
    }));
  },
}));
