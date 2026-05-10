'use client';

import { useTranslation } from './i18n';

/**
 * Formats a file size in bytes to a human-readable, localized string.
 * @param bytes - The file size in bytes.
 * @returns A formatted string representing the file size (e.g., "1.5 MB").
 */
export const useFormatFileSize = () => {
  const { formatFileSize } = useTranslation('en'); // Default to 'en' for the hook, but i18n handles the active language.
  return formatFileSize;
};

/**
 * Formats a file size in bytes to a human-readable, localized string.
 * @param bytes - The file size in bytes.
 * @returns A formatted string representing the file size (e.g., "1.5 MB").
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return `0 B`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${value} ${sizes[i]}`;
};
