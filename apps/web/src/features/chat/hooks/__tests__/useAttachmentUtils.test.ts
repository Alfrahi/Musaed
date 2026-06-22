import { handleTauriImageUploadInternal } from '../useAttachmentUtils';
import { describe, expect, it, vi } from 'vitest';
import { dialog, fs } from '../../../../lib/ipc';
import toast from 'react-hot-toast';

// Mock the Tauri IPC functions
vi.mock('../../../../lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  dialog: {
    open: vi.fn(),
  },
  fs: {
    readFile: vi.fn(),
  },
}));

// Mock the logger
vi.mock('../../../lib/logger', () => ({
  logger: {
    error: vi.fn((message, context) => {
      console.log('Logger error called with:', message, context);
    }),
  },
}));

// Mock the toast
vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn((message) => {
      console.log('Toast error called with:', message);
    }),
  },
}));

describe('handleTauriImageUploadInternal', () => {
  it('should handle image uploads correctly', async () => {
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/test.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    const mockReadFile = vi
      .fn()
      .mockResolvedValue(new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0]));
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    const mockT = vi.fn((key) => key);

    const result = await handleTauriImageUploadInternal(mockT);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('data:image/png;base64,');
  });

  it('should handle large files gracefully', async () => {
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/large.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    const largeData = new Uint8Array(11 * 1024 * 1024).fill(0);
    const mockReadFile = vi.fn().mockResolvedValue(largeData);
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    const mockT = vi.fn((key) => key);

    const result = await handleTauriImageUploadInternal(mockT);

    expect(result).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('error.fileTooLarge');
  });

  it('should handle invalid characters gracefully', async () => {
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/invalid.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    const invalidData = new Uint8Array([255, 254, 253, 252]);
    const mockReadFile = vi.fn().mockResolvedValue(invalidData);
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    const mockT = vi.fn((key) => key);

    const result = await handleTauriImageUploadInternal(mockT);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('data:image/png;base64,');
  });
});
