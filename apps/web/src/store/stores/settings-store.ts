'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatSettingsSchema, type ChatSettings, DEFAULT_SETTINGS } from '@musaed/contracts';
import { createTauriStorage } from '../../lib/tauri-storage';
import { useUIStore } from './ui-store';

/**
 * Migration registry for settings-store. Add handlers as schema evolves.
 * Version 1: Initial schema with all current ChatSettings fields.
 */
const SETTINGS_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data: unknown) => {
    // Merge persisted partial data with defaults to ensure schema integrity
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ChatSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...persisted };
  },
};

interface SettingsState {
  globalSettings: ChatSettings;
  setGlobalSettings: (globalSettings: ChatSettings) => void;
}

// Selectors for the settings store
export const selectTheme = (state: SettingsState) => state.globalSettings.theme;

export const selectIsSettingEnabled = (key: keyof ChatSettings) => (state: SettingsState) =>
  !!state.globalSettings[key];

export const useSettingsStore = createWithEqualityFn<SettingsState>()(
  persist(
    (set) => ({
      globalSettings: DEFAULT_SETTINGS,
      setGlobalSettings: (globalSettings) => set({ globalSettings }),
    }),
    {
      name: 'musaed-settings-storage',
      storage: createJSONStorage(() =>
        createTauriStorage('settings-state.json', 1, SETTINGS_MIGRATIONS)
      ),
      version: 1,
      migrate: (persistedState, version) => {
        // Apply migration for the current version if exists, otherwise merge with defaults
        const migration = SETTINGS_MIGRATIONS[1];
        if (migration && typeof persistedState === 'object' && persistedState !== null) {
          return migration(persistedState);
        }
        // Fallback: merge with defaults to ensure all fields exist
        const persisted =
          typeof persistedState === 'object' ? (persistedState as Partial<ChatSettings>) : {};
        return { ...DEFAULT_SETTINGS, ...persisted };
      },
      skipHydration: true,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            console.error('Settings store rehydration failed:', error);
          } else if (state) {
            // Validate rehydrated state against schema
            const result = ChatSettingsSchema.safeParse(state.globalSettings);
            if (!result.success) {
              console.warn(
                'Rehydrated settings failed validation, resetting to defaults:',
                result.error
              );
              state.globalSettings = DEFAULT_SETTINGS;
            }
          }
          useUIStore.getState().onStoreRehydrated();
        };
      },
    }
  ),
  shallow
);
