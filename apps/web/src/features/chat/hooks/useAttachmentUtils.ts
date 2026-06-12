'use client';

import { checkIsTauri, dialog, fs } from '../../../lib/ipc';
import { logger } from '../../../lib/logger';
import toast from 'react-hot-toast';

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  content: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] as const;

/**
 * Extracts filename from a full file path.
 */
export function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/**
 * Returns MIME type based on file extension.
 */
export function mimeFromExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    py: 'text/x-python',
    js: 'text/javascript',
    ts: 'text/typescript',
    rs: 'text/rust',
    go: 'text/x-go',
    java: 'text/x-java',
    html: 'text/html',
    css: 'text/css',
    xml: 'text/xml',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    toml: 'text/toml',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Validates file size and shows user-friendly error if exceeded.
 */
export function validateFileSize(size: number, t: (key: string) => string): boolean {
  if (size > MAX_FILE_SIZE) {
    toast.error(t('error.fileTooLarge'));
    return false;
  }
  return true;
}

/**
 * Handles native Tauri image upload.
 * Returns array of data URLs (base64).
 */
export async function handleTauriImageUploadInternal(
  t: (key: string) => string
): Promise<string[]> {
  if (!checkIsTauri()) return [];

  const selected = await dialog.open({
    multiple: true,
    filters: [{ name: t('chat.attachImage'), extensions: [...IMAGE_EXTENSIONS] }],
  });

  if (!selected) return [];

  const paths = Array.isArray(selected) ? selected : [selected];
  const newImages: string[] = [];

  for (const filePath of paths) {
    const data = await fs.readFile(filePath);
    if (!data) {
      logger.error('Failed to read image file', { path: filePath });
      continue;
    }

    if (!validateFileSize(data.byteLength, t)) continue;

    const mime = mimeFromExtension(filePath);
    try {
      const buffer = Buffer.from(data);
      const base64 = buffer.toString('base64');
    } catch (error) {
      logger.error('Failed to convert image to base64', { path: filePath, error });
      toast.error(t('error.imageConversionFailed'));
      continue;
    }
    newImages.push(`data:${mime};base64,${base64}`);
  }

  return newImages;
}

/**
 * Handles native Tauri file upload.
 * Returns array of FileAttachment objects.
 */
export async function handleTauriFileUploadInternal(
  t: (key: string) => string
): Promise<FileAttachment[]> {
  if (!checkIsTauri()) return [];

  const selected = await dialog.open({
    multiple: true,
    filters: [{ name: t('common.files'), extensions: ['*'] }],
  });

  if (!selected) return [];

  const paths = Array.isArray(selected) ? selected : [selected];
  const newFiles: FileAttachment[] = [];

  for (const filePath of paths) {
    const content = await fs.readTextFile(filePath);
    if (content === null) {
      logger.error('Failed to read file', { path: filePath });
      continue;
    }

    const size = new Blob([content]).size;
    if (!validateFileSize(size, t)) continue;

    newFiles.push({
      name: fileNameFromPath(filePath),
      size,
      type: mimeFromExtension(filePath),
      content,
    });
  }

  return newFiles;
}
