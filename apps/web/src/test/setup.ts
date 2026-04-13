import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Do not set __TAURI_INTERNALS__ here — persisted stores should use localStorage in Vitest.
// Tests that need a Tauri host (e.g. ipc.test.ts) define the global in that file only.

// Mocking window.crypto for UUID generation in tests
Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid',
  },
});

// Mocking scroll functions for Virtuoso/Window
window.HTMLElement.prototype.scrollTo = vi.fn();