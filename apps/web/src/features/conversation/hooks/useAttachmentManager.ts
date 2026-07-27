'use client';

import { useState, useCallback } from 'react';
import { useSettingsStore } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';
import {
  type FileAttachment,
  handleTauriImageUploadInternal,
  handleTauriFileUploadInternal,
  processImagePaths,
  processFilePaths,
} from './useAttachmentUtils';

/**
 * Manages image and file attachments for the chat input.
 * Pure Tauri desktop implementation — no web fallback.
 */
export function useAttachmentManager() {
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  const clearAttachments = useCallback(() => {
    setImages([]);
    setFiles([]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleTauriImageUpload = useCallback(async () => {
    const newImages = await handleTauriImageUploadInternal(t);
    setImages((prev) => [...prev, ...newImages]);
  }, [t]);

  const handleTauriFileUpload = useCallback(async () => {
    const newFiles = await handleTauriFileUploadInternal(t);
    setFiles((prev) => [...prev, ...newFiles]);
  }, [t]);

  /**
   * Processes dropped files through the same attachment-validation pipeline
   * as the file-picker button. Accepts pre-classified image and file paths
   * from the Tauri-native drag-drop event so the frontend never reads file
   * content directly (STANDARDS §16).
   */
  const handleDroppedFiles = useCallback(
    async (imagePaths: string[], filePaths: string[]) => {
      const [newImages, newFiles] = await Promise.all([
        processImagePaths(imagePaths, t),
        processFilePaths(filePaths, t),
      ]);
      setImages((prev) => [...prev, ...newImages]);
      setFiles((prev) => [...prev, ...newFiles]);
    },
    [t]
  );

  return {
    images,
    files,
    handleTauriImageUpload,
    handleTauriFileUpload,
    handleDroppedFiles,
    removeImage,
    removeFile,
    clearAttachments,
  };
}
