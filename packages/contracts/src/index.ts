'use client';

import { type BackendError } from './errors';

// Core re-exports for the contracts package
export * from './errors';
export * from './constants';
export * from './command-versions';
export * from './latency';
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
export * from './utils/sanitize';
export * from './utils/thinking-tags';
export * from './utils/workerUtils';
export * from './utils/async';

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: BackendError;
}

// IPC versioning
export const IPC_VERSION = 1;

// Generated types from Rust
// export * from './generated/specta-types';
