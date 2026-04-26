"use client";

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatSettings, DEFAULT_SETTINGS } from '@musaed/contracts';
import { createTauriStorage } from '../../lib/tauri-storage';

interface SettingsState {
  globalSettings: ChatSettings;
  setGlobalSettings: (globalSettings: ChatSettings) => void;
}

// Selectors for the settings store
export const selectTheme = (state: SettingsState) =>
  state.globalSettings.theme;

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
      storage: createJSONStorage(() => createTauriStorage('settings-state.json')),
    }
  ),
  shallow
);