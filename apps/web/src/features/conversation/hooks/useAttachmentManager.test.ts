import { render, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAttachmentManager } from './useAttachmentManager';

// Mock the IPC and utility modules
vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  dialog: { open: vi.fn() },
  fs: { readFile: vi.fn(), readTextFile: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() },
}));

// Mock the settings store
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({
      globalSettings: { language: 'en' },
    })
  ),
}));

// Mock i18n
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (n: number) => String(n),
    formatDate: (d: number | Date) => String(d),
    isRtl: false,
    formatFileSize: (b: number) => `${b} B`,
  }),
}));

// Mock the attachment utils — we test the manager's orchestration, not the I/O.
// Use vi.hoisted so the mock functions are available inside the hoisted vi.mock factory.
const { mockProcessImagePaths, mockProcessFilePaths } = vi.hoisted(() => ({
  mockProcessImagePaths: vi.fn(),
  mockProcessFilePaths: vi.fn(),
}));

vi.mock('./useAttachmentUtils', () => ({
  handleTauriImageUploadInternal: vi.fn(),
  handleTauriFileUploadInternal: vi.fn(),
  processImagePaths: mockProcessImagePaths,
  processFilePaths: mockProcessFilePaths,
}));

/**
 * Minimal renderHook helper using @testing-library/react.
 * Renders a component that calls the hook and captures its return value.
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
    rerender: () => {
      render(React.createElement(TestComponent));
    },
  };
}

describe('useAttachmentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDroppedFiles', () => {
    it('processes image and file paths through the shared pipeline', async () => {
      mockProcessImagePaths.mockResolvedValue(['data:image/png;base64,abc']);
      mockProcessFilePaths.mockResolvedValue([
        { name: 'readme.md', size: 100, type: 'text/markdown', content: '# Hello' },
      ]);

      const { result } = renderHook(() => useAttachmentManager());

      // Call handleDroppedFiles and wait for the async state updates
      await act(async () => {
        await result.current.handleDroppedFiles(['/path/img.png'], ['/path/readme.md']);
      });

      expect(mockProcessImagePaths).toHaveBeenCalledWith(['/path/img.png'], expect.any(Function));
      expect(mockProcessFilePaths).toHaveBeenCalledWith(['/path/readme.md'], expect.any(Function));
      expect(result.current.images).toEqual(['data:image/png;base64,abc']);
      expect(result.current.files).toEqual([
        { name: 'readme.md', size: 100, type: 'text/markdown', content: '# Hello' },
      ]);
    });

    it('appends to existing images and files', async () => {
      mockProcessImagePaths.mockResolvedValue(['data:image/png;base64,new']);
      mockProcessFilePaths.mockResolvedValue([
        { name: 'new.txt', size: 50, type: 'text/plain', content: 'new' },
      ]);

      const { result } = renderHook(() => useAttachmentManager());

      // First drop
      await act(async () => {
        await result.current.handleDroppedFiles(['/path/a.png'], ['/path/a.txt']);
      });

      // Second drop
      await act(async () => {
        await result.current.handleDroppedFiles(['/path/b.png'], ['/path/b.txt']);
      });

      expect(result.current.images).toHaveLength(2);
      expect(result.current.files).toHaveLength(2);
    });

    it('handles empty arrays gracefully', async () => {
      mockProcessImagePaths.mockResolvedValue([]);
      mockProcessFilePaths.mockResolvedValue([]);

      const { result } = renderHook(() => useAttachmentManager());

      await result.current.handleDroppedFiles([], []);

      expect(result.current.images).toEqual([]);
      expect(result.current.files).toEqual([]);
    });
  });
});
