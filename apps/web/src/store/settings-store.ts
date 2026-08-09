'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import { ChatSettingsSchema, type ChatSettings, DEFAULT_SETTINGS } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';
import { logger } from '@/lib/logger';

/**
 * Migration registry for settings-store. Add handlers as schema evolves.
 * Version 1: Initial schema with all current ChatSettings fields.
 * Version 2: Convert snake_case fields (top_k, top_p, num_predict, num_ctx)
 *            to camelCase (topK, topP, numPredict, numCtx) to match Rust
 *            `#[serde(rename_all = "camelCase")]` on ChatSettings.
 * Version 3: Backfill `showTokenIndicator`, `closeToTray`, `sidebarWidth`
 *            from DEFAULT_SETTINGS so persisted state at v2 does not trip
 *            Rust serde on `cmd_conversation_create`
 *            contract alignment, STANDARDS §9 schema-change migration rule).
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
      'closeToTray',
      'showTokenIndicator',
    ];
    otherKeys.forEach((k) => {
      if (k in persisted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (migrated as any)[k] = persisted[k];
      }
    });
    return { ...DEFAULT_SETTINGS, ...migrated };
  },
  3: (data: unknown) => {
    // Merge with defaults to backfill showTokenIndicator/closeToTray/
    // sidebarWidth for users with a persisted v2 store. Idempotent and
    // type-tolerant: invalid values fall back to the DEFAULT_SETTINGS entry
    // already merged in `merged`.
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ChatSettings>) : {};
    const merged: ChatSettings = { ...DEFAULT_SETTINGS, ...persisted };
    if (typeof merged.showTokenIndicator !== 'boolean') merged.showTokenIndicator = true;
    if (typeof merged.closeToTray !== 'boolean') merged.closeToTray = true;
    if (typeof merged.sidebarWidth !== 'number') merged.sidebarWidth = 260;
    return merged;
  },
};

export interface SettingsState {
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
        createTauriStorage('settings-state.json', 3, SETTINGS_MIGRATIONS)
      ),
      version: 3,
      migrate: (_persistedState: unknown, _version: number) => {
        // Migrations are handled by createTauriStorage (canonical path).
        // This is a safety-net default-state merge only.
        if (!_persistedState || typeof _persistedState !== 'object') {
          return { globalSettings: DEFAULT_SETTINGS };
        }
        const persistedRoot = _persistedState as { globalSettings?: Partial<ChatSettings> };
        const settings = persistedRoot.globalSettings ?? {};
        return { globalSettings: { ...DEFAULT_SETTINGS, ...settings } };
      },
      skipHydration: true,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error) {
            logger.error('Settings store rehydration failed:', { error: String(error) });
          } else if (state) {
            // Validate rehydrated state against schema
            const result = ChatSettingsSchema.safeParse(state.globalSettings);
            if (!result.success) {
              logger.warn('Rehydrated settings failed validation, resetting to defaults:', {
                error: result.error,
              });
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
export const useEnterToSend = () => useSettingsStore((state) => state.globalSettings.enterToSend);
export const useChatRetentionDays = () =>
  useSettingsStore((state) => state.globalSettings.chatRetentionDays);
export const useSetGlobalSettings = () => useSettingsStore((state) => state.setGlobalSettings);
