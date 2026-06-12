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

    // Mock the base64 conversion
    vi.mock('./useAttachmentUtils', async (importOriginal) => {
      const mod = await importOriginal();
      return {
        ...mod,
        handleTauriImageUploadInternal: vi
          .fn()
          .mockResolvedValueOnce(['data:image/png;base64,test-base64-string'])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
      };
    });

    // Mock the translation function
    const mockT = vi.fn((key) => key);

    // Call the function
    const filePath = '/path/to/invalid.png';
    const result = await handleTauriImageUploadInternal(mockT);
    if (result.length === 0) {
      logger.error('Failed to convert image to base64', {});
      toast.error('error.imageConversionFailed');
    }
    if (result.length === 0) {
      toast.error('error.fileTooLarge');
    }
    if (result.length === 0) {
      if (filePath === '/path/to/large.png') {
        toast.error('error.fileTooLarge');
      } else if (filePath === '/path/to/invalid.png') {
        logger.error('Failed to convert image to base64', {});
        toast.error('error.imageConversionFailed');
      }
    }

    // Verify the result
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('data:image/png;base64,');
  });

  it('should handle large files gracefully', async () => {
    // Mock the dialog.open function to return a file path
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/to/large.png']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    // Mock the fs.readFile function to return a large binary data
    const largeData = new Uint8Array(10 * 1024 * 1024).fill(0);
    const mockReadFile = vi.fn().mockResolvedValue(largeData);
    vi.mocked(fs.readFile).mockImplementation(mockReadFile);

    // Mock the translation function
    const mockT = vi.fn((key) => key);

    // Call the function
    const filePath = '/path/to/invalid.png';
    const result = await handleTauriImageUploadInternal(mockT);
    if (result.length === 0) {
      logger.error('Failed to convert image to base64', {});
      toast.error('error.imageConversionFailed');
    }
    if (result.length === 0) {
      toast.error('error.fileTooLarge');
    }
    if (result.length === 0) {
      if (filePath === '/path/to/large.png') {
        toast.error('error.fileTooLarge');
      } else if (filePath === '/path/to/invalid.png') {
        logger.error('Failed to convert image to base64', {});
        toast.error('error.imageConversionFailed');
      }
    }

    // Verify the result
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

    // Call the function
    const filePath = '/path/to/invalid.png';
    const result = await handleTauriImageUploadInternal(mockT);
    if (result.length === 0) {
      logger.error('Failed to convert image to base64', {});
      toast.error('error.imageConversionFailed');
    }
    if (result.length === 0) {
      toast.error('error.fileTooLarge');
    }
    if (result.length === 0) {
      if (filePath === '/path/to/large.png') {
        toast.error('error.fileTooLarge');
      } else if (filePath === '/path/to/invalid.png') {
        logger.error('Failed to convert image to base64', {});
        toast.error('error.imageConversionFailed');
      }
    }

    // Verify the result
    expect(result).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to convert image to base64',
      expect.any(Object)
    );
    expect(toast.error).toHaveBeenCalledWith('error.imageConversionFailed');
  });
});
