import { render, waitFor, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  ollamaApi: {
    getModels: vi.fn().mockResolvedValue([]),
  },
}));

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('@/lib/i18n', () => ({
  translate: vi.fn((key: string) => key),
}));

const { mockUpdatePullStatus, mockSetModels } = vi.hoisted(() => ({
  mockUpdatePullStatus: vi.fn(),
  mockSetModels: vi.fn(),
}));

vi.mock('@/store/model-store', () => ({
  useModelStore: {
    getState: () => ({
      updatePullStatus: mockUpdatePullStatus,
      setModels: mockSetModels,
    }),
  },
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({
      globalSettings: { language: 'en', ollamaUrl: 'http://localhost:11434' },
    }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { useLibraryTauriEvents } from './useLibraryTauriEvents';

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

describe('useLibraryTauriEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlerBoxes).forEach((k) => {
      handlerBoxes[k] = null;
    });
  });

  it('registers pull-progress and pull-error listeners on mount', async () => {
    renderHook(() => useLibraryTauriEvents());

    await waitFor(() => {
      expect(handlerBoxes['pull-progress']).not.toBeNull();
    });
    expect(handlerBoxes['pull-error']).not.toBeNull();
  });

  it('fires toast.success on pull-progress success event', async () => {
    renderHook(() => useLibraryTauriEvents());

    await waitFor(() => {
      expect(handlerBoxes['pull-progress']).not.toBeNull();
    });

    await act(async () => {
      await handlerBoxes['pull-progress']!({
        name: 'test-model',
        status: 'success',
        total: 100,
        completed: 100,
      });
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('library.pullSuccess');
    expect(mockSetModels).toHaveBeenCalled();
  });

  it('updates pull status on pull-progress event', async () => {
    renderHook(() => useLibraryTauriEvents());

    await waitFor(() => {
      expect(handlerBoxes['pull-progress']).not.toBeNull();
    });

    act(() => {
      handlerBoxes['pull-progress']!({
        name: 'test-model',
        status: 'downloading',
        total: 200,
        completed: 50,
      });
    });

    expect(mockUpdatePullStatus).toHaveBeenCalledWith('test-model', {
      status: 'downloading',
      progress: 25,
      completed: 50,
      total: 200,
    });
  });

  it('fires toast.error on pull-error event', async () => {
    renderHook(() => useLibraryTauriEvents());

    await waitFor(() => {
      expect(handlerBoxes['pull-error']).not.toBeNull();
    });

    act(() => {
      handlerBoxes['pull-error']!({ name: 'test-model', error: 'Pull failed' });
    });

    expect(mockToastError).toHaveBeenCalled();
    expect(mockUpdatePullStatus).toHaveBeenCalledWith('test-model', { status: 'error' });
  });
});
