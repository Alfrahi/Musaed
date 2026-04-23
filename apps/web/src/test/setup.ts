import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';

// ── Tauri IPC Mock ──────────────────────────────────────────────────────────
// Sets up __TAURI_INTERNALS__ so checkIsTauri() returns true in all tests.
// Individual tests register command handlers via mockIPC() as needed.
// clearMocks() is called after each test to reset the IPC handler.

mockIPC(() => {});

afterEach(() => {
  clearMocks();
});

// ── Crypto ──────────────────────────────────────────────────────────────────
// Deterministic UUID for snapshot stability.

Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid',
  },
});

// ── Scroll ──────────────────────────────────────────────────────────────────
// Virtuoso / Window scroll mocks for headless test environment.

window.HTMLElement.prototype.scrollTo = vi.fn();
