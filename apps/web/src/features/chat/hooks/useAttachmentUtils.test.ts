import { handleTauriImageUploadInternal } from './useAttachmentUtils';
import { describe, expect, it, vi } from 'vitest';
import { dialog, fs } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';

// Mock the Tauri IPC functions
vi.mock('../../../lib/ipc', () => ({
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
    // Mock the dialog.open function to return a file path
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/test.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    // Mock the fs.readFile function to return binary data
    const mockReadFile = vi
      .fn()
      .mockResolvedValue(new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0]));
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    // Mock the translation function
    const mockT = vi.fn((key) => key);

    // Call the function
    const result = await handleTauriImageUploadInternal(mockT);

    // Verify the result
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('data:image/png;base64,');
  });

  it('should handle large files gracefully', async () => {
    // Mock the dialog.open function to return a file path
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/large.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    // Mock the fs.readFile function to return a large binary data (over 10MB limit)
    const largeData = new Uint8Array(11 * 1024 * 1024).fill(0);
    const mockReadFile = vi.fn().mockResolvedValue(largeData);
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    // Mock the translation function
    const mockT = vi.fn((key) => key);

    // Call the function
    const result = await handleTauriImageUploadInternal(mockT);

    // Verify the result - large files should be filtered out by validateFileSize
    expect(result).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('error.fileTooLarge');
  });

  it('should handle invalid characters gracefully', async () => {
    // Mock the dialog.open function to return a file path
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/invalid.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    // Mock the fs.readFile function to return binary data with invalid characters
    const invalidData = new Uint8Array([255, 254, 253, 252]);
    const mockReadFile = vi.fn().mockResolvedValue(invalidData);
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    // Mock the translation function
    const mockT = vi.fn((key) => key);

    // Call the function - should successfully convert even "invalid" data to base64
    const result = await handleTauriImageUploadInternal(mockT);

    // Verify the result - base64 conversion succeeds for any binary data
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('data:image/png;base64,');
  });
});
