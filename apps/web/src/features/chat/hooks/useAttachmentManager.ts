"use client";

import { useState, useCallback } from 'react';
import { useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import {
  FileAttachment,
  handleTauriImageUploadInternal,
  handleTauriFileUploadInternal,
} from './useAttachmentUtils';

/**
 * Manages image and file attachments for the chat input.
 * Pure Tauri desktop implementation — no web fallback.
 */
export function useAttachmentManager() {
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);

  const { t } = useTranslation(useLanguage());

  const clearAttachments = useCallback(() => {
    setImages([]);
    setFiles([]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleTauriImageUpload = useCallback(async () => {
    const newImages = await handleTauriImageUploadInternal(t);
    setImages(prev => [...prev, ...newImages]);
  }, [t]);

  const handleTauriFileUpload = useCallback(async () => {
    const newFiles = await handleTauriFileUploadInternal(t);
    setFiles(prev => [...prev, ...newFiles]);
  }, [t]);

  return {
    images,
    files,
    handleTauriImageUpload,
    handleTauriFileUpload,
    removeImage,
    removeFile,
    clearAttachments,
  };
}
