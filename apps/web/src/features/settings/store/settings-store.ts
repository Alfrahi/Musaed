'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatSettingsSchema, type ChatSettings, DEFAULT_SETTINGS } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';

/**
 * Migration registry for settings-store. Add handlers as schema evolves.
 * Version 1: Initial schema with all current ChatSettings fields.
 * Version 2: Convert snake_case fields (top_k, top_p, num_predict, num_ctx)
 *            to camelCase (topK, topP, numPredict, numCtx) to match Rust
 *            `#[serde(rename_all = "camelCase")]` on ChatSettings.
 */
const SETTINGS_MIGRATIONS: Record<number, (data: unknown) => Partial<ChatSettings>> = {
  1: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ChatSettings>) : {};
    return { ...DEFAULT_SETTINGS, ...persisted };
  },
  2: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const migrated: Partial<ChatSettings> = {};
    if ('top_k' in persisted) migrated.topK = persisted['top_k'] as number;
    if ('top_p' in persisted) migrated.topP = persisted['top_p'] as number;
    if ('num_predict' in persisted) migrated.numPredict = persisted['num_predict'] as number;
    if ('num_ctx' in persisted) migrated.numCtx = persisted['num_ctx'] as number;
    // Preserve other fields if present
    const otherKeys: (keyof ChatSettings)[] = [
      'temperature',
      'stop',
      'systemPrompt',
      'ollamaUrl',
      'language',
      'theme',
      'hasDetectedLanguage',
      'enterToSend',
      'chatRetentionDays',
      'enableLatex',
      'enableMermaid',
      'density',
    ];
    otherKeys.forEach((k) => {
      if (k in persisted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (migrated as any)[k] = persisted[k];
      }
    });
    return { ...DEFAULT_SETTINGS, ...migrated };
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
        createTauriStorage('settings-state.json', 2, SETTINGS_MIGRATIONS)
      ),
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { globalSettings: DEFAULT_SETTINGS };
        }
        const persistedRoot = persistedState as { globalSettings?: Partial<ChatSettings> };
        let settings = persistedRoot.globalSettings ?? {};
        for (let v = (version ?? 0) + 1; v <= 2; v++) {
          const migration = SETTINGS_MIGRATIONS[v];
          if (migration) settings = migration(settings);
        }
        return { globalSettings: { ...DEFAULT_SETTINGS, ...settings } };
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

// Selector hooks for settings
export const useOllamaUrl = () => useSettingsStore((state) => state.globalSettings.ollamaUrl);
export const useGlobalSettings = () => useSettingsStore((state) => state.globalSettings);
export const useLanguage = () => useSettingsStore((state) => state.globalSettings.language);
export const useChatRetentionDays = () =>
  useSettingsStore((state) => state.globalSettings.chatRetentionDays);
export const useSetGlobalSettings = () => useSettingsStore((state) => state.setGlobalSettings);
