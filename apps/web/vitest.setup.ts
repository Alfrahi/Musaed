import { vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock window.__TAURI_INTERNALS__ for Tauri API
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    invoke: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

// Mock Tauri store, ipc and logger modules
vi.mock('./src/lib/ipc', async () => {
  const actual = await vi.importActual('./src/lib/__mocks__/ipc');
  return actual;
});

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Mock ResizeObserver for chat components
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver for virtualized chat components
// Must be a constructor function (called with `new` in ScrollShadow).
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds = [];
}

global.IntersectionObserver = IntersectionObserverMock;
