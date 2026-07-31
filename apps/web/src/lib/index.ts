/**
 * Shared Infrastructure Layer
 *
 * This module exports only shared infrastructure that is used across multiple features:
 * - IPC layer (single entry point for Tauri commands)
 * - I18n (internationalization)
 * - Logging & observability
 * - Pure utilities
 * - Configuration
 * - Storage abstractions
 * - Migration framework
 *
 * DO NOT import feature internals from here. Features should export their public API
 * via their own index.ts files.
 */

// IPC - single entry point for all Tauri commands
export {
  checkIsTauri,
  isValidOllamaUrl,
  ollamaApi,
  chatApi,
  logApi,
  listen,
  dialogApi,
  openerApi,
  storeApi,
  fsApi,
  traceApi,
  titleApi,
  conversationApi,
  migrationApi,
} from '@/lib/ipc';
export type { CommandMap } from '@/lib/ipc';

// I18n - shared internationalization
export {
  useTranslation,
  getSystemLanguage,
  translate,
  setActiveLanguageResolver,
  getActiveLanguage,
} from '@/lib/i18n';
export type { TranslationKey } from '@/lib/i18n';

// Logging & observability - shared infrastructure
export { logger } from '@/lib/logger';

// Utilities - pure functions
export { cn } from '@/lib/utils';

// Configuration - environment abstraction
export { config } from '@/lib/config';

// Storage - Tauri-backed Zustand persistence
export { createTauriStorage } from '@/lib/tauri-storage';
export type { MigrationFn } from '@/lib/tauri-storage';

// Migrations - shared migration framework
export { runMigrations, MigrationError, MigrationErrorCode } from '@/lib/migrations';
export type { MigrationFn as StoreMigrationFn, MigrationResult } from '@/lib/migrations';

// Connection management - shared Ollama connection manager
export {
  OllamaConnectionManager,
  getConnectionManager,
  ConnectionState,
  type OllamaHealth,
  type ConnectionManagerConfig,
} from '@/lib/connection-manager';
