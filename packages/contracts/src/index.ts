'use client';

// Public re-exports — any module added under packages/contracts/src/ that
// is consumed across packages MUST be re-exported below. Sub-path imports
// rely on bundler/tsconfig path-mapping and are forbidden except for tests.
import { type BackendError } from './errors';

// Core re-exports for the contracts package
export * from './errors';
export * from './constants';
export * from './command-versions';
export * from './latency';
export * from './migrations';
export type * from './manifest';
export type * from './types/ollama';
export type * from './types/chat';
export type * from './types/ui';
export type * from './types/conversation';
export type * from './types/rag';
export * from './schemas/ollama';
export * from './schemas/chat';
export * from './schemas/rag';
export * from './schemas/conversation';
export * from './schemas/validation';
export * from './schemas/context-menu';
export * from './schemas/tray';
export * from './schemas/menu-bar';
export * from './utils/sanitize';
export * from './redactedThinking';

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

// IPC versioning
// Breaking-change detection is delegated to `pnpm validate:contracts --strict`,
// which cross-checks Rust #[tauri::command] signatures against the TypeScript
// CommandMap at CI time. See STANDARDS.md §5 and scripts/validate-contracts.mjs.

// Generated types from Rust
// export * from './generated/specta-types';
