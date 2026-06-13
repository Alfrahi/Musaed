'use client';

// Re-export canonical implementation from coordination.ts
// This ensures a single source of truth for flushAndStop behavior
export { flushAndStop, stopBatching } from './coordination';
