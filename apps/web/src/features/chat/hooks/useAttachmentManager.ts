"use client";

import { useState, useCallback } from 'react';
import { useSettingsStore } from '../../../store';
import { useTranslation } from '../../../lib/i18n';
import toast from 'react-hot-toast';

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  content: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB Limit

export function useAttachmentManager() {
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const { globalSettings } = useSettingsStore();
  const { t } = useTranslation(globalSettings.language);

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== index));
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, idx) => idx !== index));
  }, []);

  const clearAttachments = useCallback(() => {
    setImages([]);
    setFiles([]);
  }, []);

  const validateFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t('error.fileTooLarge'));
      return false;
    }
    return true;
  };

  const handleImageUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => {
      if (!validateFile(f)) return;
      const r = new FileReader();
      r.onloadend = () => {
        const result = r.result as string;
        if (result?.startsWith('data:')) {
          setImages(p => [...p, result]);
        }
      };
      r.readAsDataURL(f);
    });
  }, [t]);

  const handleFileUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => {
      if (!validateFile(f)) return;
      const r = new FileReader();
      r.onload = () => {
        const content = r.result as string;
        const newFile: FileAttachment = {
          name: f.name,
          size: f.size,
          type: f.type,
          content: content
        };
        setFiles(p => [...p, newFile]);
      };
      r.readAsText(f);
    });
  }, [t]);

  return {
    images,
    files,
    handleImageUpload,
    handleFileUpload,
    removeImage,
    removeFile,
    clearAttachments
  };
}