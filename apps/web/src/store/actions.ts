"use client";

/**
 * Imperative store action bridges.
 *
 * These functions allow one store to trigger state changes in another store
 * from outside React's component lifecycle (e.g., inside Zustand set() updaters
 * or persist middleware callbacks), without creating a direct import dependency
 * between store modules.
 *
 * Each store module should import from this file rather than importing another
 * store module directly.
 */

import { useUIStore } from './stores/ui-store';

export function setStreaming(isStreaming: boolean): void {
  useUIStore.getState().setStreaming(isStreaming);
}

export function setHydrated(isHydrated: boolean): void {
  useUIStore.getState().setHydrated(isHydrated);
}
