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
  dialog,
  opener,
  store,
  fs,
  traceApi,
  titleApi,
  conversationApi,
} from './ipc';
export type { CommandMap } from './ipc';

// I18n - shared internationalization
export { useTranslation, getSystemLanguage } from './i18n';
export type { TranslationKey } from './i18n';

// Logging & observability - shared infrastructure
export { logger } from './logger';
export { traceLogger, structuredLogger, traceAsync } from './trace-logger';
export type { TraceSpan, TraceOptions, TraceCompleteOptions } from './trace-logger';

// Utilities - pure functions
export { cn } from './utils';

// Configuration - environment abstraction
export { config } from './config';

// Storage - Tauri-backed Zustand persistence
export { createTauriStorage } from './tauri-storage';
export type { MigrationFn } from './tauri-storage';

// Migrations - shared migration framework
export { runMigrations, MigrationError, MigrationErrorCode } from './migrations';
export type { MigrationFn as StoreMigrationFn, MigrationResult } from './migrations';

// Connection management - shared Ollama connection manager
export {
  OllamaConnectionManager,
  getConnectionManager,
  ConnectionState,
  type OllamaHealth,
  type ConnectionManagerConfig,
} from './connection-manager';
