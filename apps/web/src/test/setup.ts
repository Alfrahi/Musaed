import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri global internals for checkIsTauri()
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    invoke: vi.fn(),
    plugins: {},
  },
  writable: true,
});

// Mocking window.crypto for UUID generation in tests
Object.defineProperty(window, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid',
  },
});

// Mocking scroll functions for Virtuoso/Window
window.HTMLElement.prototype.scrollTo = vi.fn();