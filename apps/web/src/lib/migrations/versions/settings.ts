/**
 * Settings Store Migrations
 *
 * Defines migrations for the settings-store schema evolution.
 * Each migration transforms state from version N-1 to version N.
 *
 * Current schema version: 3
 * Migration path: v0 → v1 (initial schema) → v2 (add density field)
 *                      → v3 (showTokenIndicator + closeToTray + sidebarWidth
 *                            contract alignment)
 */

import { createIdempotentMigration } from '@/lib/migrations/orchestrator';
import { DEFAULT_SETTINGS, type ChatSettings } from '@musaed/contracts';
import { ChatSettingsSchema } from '@musaed/contracts';

/**
 * Migration v1 → v2 (2026-06-15)
 * Adds `density` field for UI density settings.
 *
 * Change: density: number = 1.0 (default)
 * Why: Support user-controlled UI density scaling
 * Rollback: Safe (removes non-critical field)
 */
export const migrateSettingsToV2 = createIdempotentMigration<ChatSettings>((data: ChatSettings) => {
  // Merge with defaults to ensure all fields exist
  const merged = { ...DEFAULT_SETTINGS, ...data };

  // Ensure density field exists with default value
  if (typeof merged.density !== 'number') {
    merged.density = 1.0;
  }

  return merged;
}, 2);

/**
 * Migration v2 → v3 (2026-08-04)
 * Adds `showTokenIndicator` (UX-UI-AUDIT Prompt 14 — token/context-window
 * visualization toggle) and aligns `closeToTray`/`sidebarWidth` (already in
 * the TS schema and DEFAULT_SETTINGS) onto the persisted state so the Rust
 * serde deserializer for `cmd_conversation_create` no longer rejects with
 * "missing field `showTokenIndicator`".
 *
 * Change: showTokenIndicator: boolean = true (default), plus backfill of any
 *         other DEFAULT_SETTINGS field missing from older persisted state.
 * Why: STANDARDS §9 — "ALL schema changes require migration logic." Users
 *      with persisted `settings-state.json` at v2 already have the new field
 *      absent; without a v3 migration the rehydration path skips the merge
 *      with DEFAULT_SETTINGS (Tauri-storage early-returns when storedVersion
 *      >= currentVersion) and the field-absent payload then trips Rust serde.
 * Rollback: Safe — drops the three fields; v2 state is fully descriptive.
 */
export const migrateSettingsToV3 = createIdempotentMigration<ChatSettings>((data: ChatSettings) => {
  const merged = { ...DEFAULT_SETTINGS, ...data };

  // Ensure showTokenIndicator is a boolean (backfill the default if absent
  // or wrong-typed from an older v2 persisted object).
  if (typeof merged.showTokenIndicator !== 'boolean') {
    merged.showTokenIndicator = true;
  }
  if (typeof merged.closeToTray !== 'boolean') {
    merged.closeToTray = true;
  }
  if (typeof merged.sidebarWidth !== 'number') {
    merged.sidebarWidth = 260;
  }

  return merged;
}, 3);

/**
 * Migration v0 → v1
 * Initial settings schema - merge with defaults.
 */
export const migrateSettingsToV1 = (data: unknown): ChatSettings => {
  return {
    ...DEFAULT_SETTINGS,
    ...(data as Record<string, unknown>),
  };
};

/**
 * Rollback v2 → v1
 * Removes `density` field.
 * Safe because field is non-critical UI preference.
 */
export const rollbackSettingsToV1 = (data: ChatSettings): Partial<ChatSettings> => {
  const { density: _density, ...rest } = data;
  return rest;
};

/**
 * Rollback v3 → v2
 * Removes `showTokenIndicator`, `closeToTray`, `sidebarWidth`.
 * Safe because all three are non-critical UI preferences with sensible
 * defaults that the v2 → v3 migration re-applies on the next forward pass.
 */
export const rollbackSettingsToV2 = (data: ChatSettings): Partial<ChatSettings> => {
  const {
    showTokenIndicator: _showTokenIndicator,
    closeToTray: _closeToTray,
    sidebarWidth: _sidebarWidth,
    ...rest
  } = data;
  return rest;
};

/**
 * Rollback v1 → v0
 * Removes all settings (returns to empty state).
 */
export const rollbackSettingsToV0 = (): Partial<ChatSettings> => {
  return {};
};

/**
 * Validation function for settings state.
 * Uses strict validation to reject unknown keys.
 */
export const validateSettings = (data: unknown): ChatSettings => {
  return ChatSettingsSchema.strict().parse(data);
};

/**
 * Settings migration registry.
 */
export const settingsMigrations = {
  1: migrateSettingsToV1,
  2: migrateSettingsToV2,
  3: migrateSettingsToV3,
};

/**
 * Bidirectional migrations for rollback support.
 */
export const settingsBidirectionalMigrations = {
  1: {
    migrate: migrateSettingsToV1,
    rollback: rollbackSettingsToV0,
    isRollbackable: true,
    description: 'Initial settings schema',
  },
  2: {
    migrate: migrateSettingsToV2,
    rollback: rollbackSettingsToV1,
    isRollbackable: true,
    description: 'Add density field for UI scaling',
  },
  3: {
    migrate: migrateSettingsToV3,
    rollback: rollbackSettingsToV2,
    isRollbackable: true,
    description:
      'showTokenIndicator + closeToTray + sidebarWidth contract alignment (UX-UI-AUDIT Prompt 14)',
  },
};
