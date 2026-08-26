'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  ChatSettingsSchema,
  type ChatSettings,
  DEFAULT_SETTINGS,
  VALIDATION_LIMITS,
} from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';
import { useUIStore } from '@/store/ui-store';
import { logger } from '@/lib/logger';
import { traceStoreMutation } from '@/lib/store-tracing';

/**
 * Snaps an out-of-bounds persisted sampling parameter to the nearest valid
 * value. Called during rehydration so legacy persisted state that predates
 * the schema bounds is corrected in-place rather than triggering a wholesale
 * reset to `DEFAULT_SETTINGS`.
 */
const clampSettingsFields = (settings: ChatSettings): ChatSettings => ({
  ...settings,
  temperature: Math.max(
    VALIDATION_LIMITS.TEMPERATURE_RANGE[0],
    Math.min(VALIDATION_LIMITS.TEMPERATURE_RANGE[1], settings.temperature)
  ),
  topK: Math.max(
    VALIDATION_LIMITS.TOP_K_RANGE[0],
    Math.min(VALIDATION_LIMITS.TOP_K_RANGE[1], settings.topK)
  ),
  topP: Math.max(
    VALIDATION_LIMITS.TOP_P_RANGE[0],
    Math.min(VALIDATION_LIMITS.TOP_P_RANGE[1], settings.topP)
  ),
  numPredict: Math.max(
    VALIDATION_LIMITS.NUM_PREDICT_RANGE[0],
    Math.min(VALIDATION_LIMITS.NUM_PREDICT_RANGE[1], settings.numPredict)
  ),
  numCtx: Math.max(
    VALIDATION_LIMITS.NUM_CTX_RANGE[0],
    Math.min(VALIDATION_LIMITS.NUM_CTX_RANGE[1], settings.numCtx)
  ),
});

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
 * Version 4: Backfill `sidebarCollapsed` (boolean) from DEFAULT_SETTINGS
 *            for persisted stores at v3. Idempotent, type-tolerant.
 * Version 5: Audit F-3 — sampling config moved to per-model profiles in
 *            model-params-store. Reset the five deprecated global sampling
 *            fields to DEFAULT_SETTINGS so persisted state stops carrying
 *            stale legacy writes. Idempotent, serde-shell-preserving.
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
  4: (data: unknown) => {
    // Backfill sidebarCollapsed for persisted stores at v3. Merging with
    // DEFAULT_SETTINGS already sets the default, but an explicit guard
    // catches any stray non-boolean value in legacy data.
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ChatSettings>) : {};
    const merged: ChatSettings = { ...DEFAULT_SETTINGS, ...persisted };
    if (typeof merged.sidebarCollapsed !== 'boolean') merged.sidebarCollapsed = false;
    return merged;
  },
  5: (data: unknown) => {
    // Audit F-3: the five global sampling fields are a dead serde shell —
    // effective values resolve per-model from model-params-store. Fold any
    // drifted legacy values back to DEFAULT_SETTINGS so the persisted file
    // stops carrying stale user writes. Idempotent.
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<ChatSettings>) : {};
    const merged: ChatSettings = { ...DEFAULT_SETTINGS, ...persisted };
    return {
      ...merged,
      temperature: DEFAULT_SETTINGS.temperature,
      topK: DEFAULT_SETTINGS.topK,
      topP: DEFAULT_SETTINGS.topP,
      numPredict: DEFAULT_SETTINGS.numPredict,
      numCtx: DEFAULT_SETTINGS.numCtx,
    };
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
      setGlobalSettings: (globalSettings) =>
        set((state) => {
          const changedKeys = (Object.keys(globalSettings) as (keyof ChatSettings)[]).filter(
            (k) => !Object.is(globalSettings[k], state.globalSettings[k])
          );
          traceStoreMutation({
            feature: 'settings',
            action: 'setGlobalSettings',
            level: 'INFO',
            message: `settings updated: ${changedKeys.join(',') || 'none'}`,
            context: { changedKeys },
            throttleMs: 0,
          });
          return { globalSettings };
        }),
    }),
    {
      name: 'musaed-settings-storage',
      storage: createJSONStorage(() =>
        createTauriStorage('settings-state.json', 5, SETTINGS_MIGRATIONS)
      ),
      version: 5,
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
            // Clamp out-of-bounds persisted values before validation so
            // legacy state is corrected in-place rather than wholesale reset.
            state.globalSettings = clampSettingsFields(state.globalSettings);
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
export const useSidebarCollapsed = () =>
  useSettingsStore((state) => state.globalSettings.sidebarCollapsed);
export const useSetGlobalSettings = () => useSettingsStore((state) => state.setGlobalSettings);
