'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { type ChatSettings, DEFAULT_SETTINGS } from '@musaed/contracts';
import { createTauriStorage } from '../../lib/tauri-storage';
import { useUIStore } from './ui-store';

/** Migration registry for settings-store. Add handlers as schema evolves. */
const SETTINGS_MIGRATIONS: Record<number, (data: unknown) => unknown> = {};

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
      migrate: (_persistedState, _version) => _persistedState,
      skipHydration: true,
      onRehydrateStorage: () => {
        return (_state, error) => {
          if (error) {
            console.error('Settings store rehydration failed:', error);
          }
          useUIStore.getState().onStoreRehydrated();
        };
      },
    }
  ),
  shallow
);
