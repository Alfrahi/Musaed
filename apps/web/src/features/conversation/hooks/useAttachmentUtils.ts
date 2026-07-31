'use client';

import { checkIsTauri, dialogApi, fsApi } from '@/lib/ipc';
import { logger } from '@/lib/logger';
import { fileNameFromPath } from '@/lib/utils';
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

  const result = await dialogApi.openFile({
    multiple: true,
    filters: [{ name: t('chat.attachImage'), extensions: [...IMAGE_EXTENSIONS] }],
  });

  if (!result) return [];

  return processImagePaths(result, t);
}

/**
 * Processes an array of image file paths into base64 data URLs.
 * Shared by the image-picker button and the drag-drop handler so both
 * paths go through the same validation and content-reading pipeline.
 *
 * STANDARDS §16 — filesystem access only via Rust IPC.
 */
export async function processImagePaths(
  paths: string[],
  t: (key: string) => string
): Promise<string[]> {
  const newImages: string[] = [];

  for (const filePath of paths) {
    const base64 = await fsApi.readFile(filePath);
    if (!base64) {
      logger.error('Failed to read image file', { path: filePath });
      continue;
    }

    // Validate file size from base64 length (approximate)
    const estimatedSize = Math.ceil((base64.length * 3) / 4);
    if (!validateFileSize(estimatedSize, t)) continue;

    const mime = mimeFromExtension(filePath);
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

  const result = await dialogApi.openFile({
    multiple: true,
    filters: [{ name: t('common.files'), extensions: ['*'] }],
  });

  if (!result) return [];

  return processFilePaths(result, t);
}

/**
 * Processes an array of file paths into FileAttachment objects.
 * Shared by the file-picker button and the drag-drop handler so both
 * paths go through the same validation and content-reading pipeline.
 *
 * STANDARDS §16 — filesystem access only via Rust IPC. This function
 * reads file content through the `fs` bridge; the frontend never
 * touches the filesystem directly.
 */
export async function processFilePaths(
  paths: string[],
  t: (key: string) => string
): Promise<FileAttachment[]> {
  const newFiles: FileAttachment[] = [];

  for (const filePath of paths) {
    const content = await fsApi.readTextFile(filePath);
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
