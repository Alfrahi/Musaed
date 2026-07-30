/**
 * Settings Store Migrations
 *
 * Defines migrations for the settings-store schema evolution.
 * Owned by the Settings feature (STANDARDS.md §3).
 *
 * Re-exported via `@/lib/migrations` for backward compatibility.
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
};