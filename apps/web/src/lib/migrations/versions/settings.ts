/**
 * Settings Store Migrations — thin re-export
 *
 * The canonical source now lives at `@/features/settings/store/migrations`.
 * This file re-exports everything for backward compatibility.
 */
export {
  settingsMigrations,
  settingsBidirectionalMigrations,
  validateSettings,
  migrateSettingsToV1,
  migrateSettingsToV2,
  rollbackSettingsToV0,
  rollbackSettingsToV1,
} from '@/features/settings/store/migrations';