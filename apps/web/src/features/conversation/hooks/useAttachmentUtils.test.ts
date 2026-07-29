import {
  mimeFromExtension,
  validateFileSize,
  handleTauriFileUploadInternal,
  handleTauriImageUploadInternal,
} from './useAttachmentUtils';
import { fileNameFromPath } from '@/lib/utils';
import { describe, it, expect, vi } from 'vitest';
import { dialog, fs } from '@/lib/ipc';
import toast from 'react-hot-toast';

// Mock the Tauri IPC functions
vi.mock('@/lib/ipc', () => ({
  checkIsTauri: vi.fn(() => true),
  dialog: {
    open: vi.fn(),
  },
  fs: {
    readFile: vi.fn(),
    readTextFile: vi.fn(),
  },
}));

// Mock the logger
vi.mock('@/lib/logger', () => ({
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

describe('utility functions', () => {
  it('fileNameFromPath extracts name', () => {
    expect(fileNameFromPath('C:/folder/file.txt')).toBe('file.txt');
    expect(fileNameFromPath('/unix/path/to/file.md')).toBe('file.md');
    expect(fileNameFromPath('no/slash')).toBe('slash');
  });

  it('mimeFromExtension returns correct types', () => {
    expect(mimeFromExtension('image.png')).toBe('image/png');
    expect(mimeFromExtension('doc.pdf')).toBe('application/pdf');
    expect(mimeFromExtension('unknown.xyz')).toBe('application/octet-stream');
  });

  it('validateFileSize returns false and shows toast on oversized files', () => {
    const mockT = vi.fn((k) => k);
    const result = validateFileSize(11 * 1024 * 1024, mockT);
    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('error.fileTooLarge');
  });
});

describe('handleTauriFileUploadInternal', () => {
  it('uploads files and respects size limit', async () => {
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/file.txt']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);

    const fileContent = 'hello world';
    const mockReadTextFile = vi.fn().mockResolvedValue(fileContent);
    vi.mocked(fs.readTextFile).mockImplementation(mockReadTextFile);

    const mockT = vi.fn((k) => k);
    const result = await handleTauriFileUploadInternal(mockT);

    expect(result).toHaveLength(1);
    const att = result[0];
    expect(att.name).toBe('file.txt');
    expect(att.content).toBe(fileContent);
    expect(att.type).toBe('text/plain');
    // size should be >0 and less than MAX_FILE_SIZE
    expect(att.size).toBeGreaterThan(0);
  });

  it('skips files larger than limit', async () => {
    const mockDialogOpen = vi.fn().mockResolvedValue(['/path/large.txt']);
    vi.mocked(dialog.open).mockImplementation(mockDialogOpen);
    const largeContent = 'a'.repeat(11 * 1024 * 1024); // >10MB
    const mockReadTextFile = vi.fn().mockResolvedValue(largeContent);
    vi.mocked(fs.readTextFile).mockImplementation(mockReadTextFile);
    const mockT = vi.fn((k) => k);
    const result = await handleTauriFileUploadInternal(mockT);
    expect(result).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith('error.fileTooLarge');
  });
});

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
