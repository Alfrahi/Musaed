import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mutable state referenced inside vi.mock factories must be wrapped in
// vi.hoisted() so the factory (hoisted above all imports) can close over it.
const { handlerBoxes, mockUnlisten } = vi.hoisted(() => {
  const boxes: Record<string, ((payload: unknown) => void) | null> = {};
  return {
    handlerBoxes: boxes,
    mockUnlisten: vi.fn(),
  };
});

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
    handlerBoxes[event] = handler;
    return Promise.resolve(mockUnlisten);
  }),
}));

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/lib/i18n', () => ({
  translate: vi.fn((key: string) => key),
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      globalSettings: { language: 'en', ollamaUrl: 'http://localhost:11434' },
    }),
  },
}));

vi.mock('@/store/streaming-store', () => ({
  useStreamingStore: {
    getState: () => ({
      activeStreams: {},
      liveContent: {},
      appendToken: vi.fn(),
      setPendingMetrics: vi.fn(),
    }),
  },
}));

vi.mock('@/store/batch-manager', () => ({
  flushAndStop: vi.fn(),
}));

vi.mock('@/store/coordination', () => ({
  stopStreamForConversation: vi.fn(),
  completeStreamForConversation: vi.fn(),
}));

vi.mock('@/store/message-store', () => ({
  useMessageStore: {
    getState: () => ({ messages: {} }),
  },
}));

vi.mock('./useAutoTitle', () => ({
  triggerAutoTitle: vi.fn(),
}));

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistMessage: vi.fn().mockResolvedValue({ success: true, retries: 0 }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { useTauriEvents } from './useTauriEvents';

/**
 * Minimal renderHook helper using @testing-library/react.
 */
function renderHook<Result>(hook: () => Result) {
  const ref: { current: Result | null } = { current: null };
  const TestComponent = () => {
    ref.current = hook();
    return null;
  };
  render(React.createElement(TestComponent));
  return {
    result: {
      get current() {
        return ref.current!;
      },
    },
  };
}

describe('useTauriEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlerBoxes).forEach((k) => {
      handlerBoxes[k] = null;
    });
  });

  it('registers event listeners on mount', async () => {
    renderHook(() => useTauriEvents());

    // The hook registers 2 listeners asynchronously; wait for the
    // ollama-error handler to be captured (the last one registered).
    await waitFor(() => {
      expect(handlerBoxes['ollama-error']).not.toBeNull();
    });
    expect(handlerBoxes['ollama-token']).not.toBeNull();
  });
});
