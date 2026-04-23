"use client";

import { useState, useCallback } from 'react';
import { useGlobalSettings, useLanguage } from '../../../store/hooks';
import { useTranslation } from '../../../lib/i18n';
import { checkIsTauri, dialog, fs } from '../../../lib/ipc';
import toast from 'react-hot-toast';

export interface FileAttachment {
  name: string;
  size: number;
  type: string;
  content: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB Limit

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function mimeFromExtension(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
    json: 'application/json', csv: 'text/csv',
    py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript',
    rs: 'text/rust', go: 'text/x-go', java: 'text/x-java',
    html: 'text/html', css: 'text/css', xml: 'text/xml',
    yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/toml',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

export function useAttachmentManager() {
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const globalSettings = useGlobalSettings();
  const language = useLanguage();
  const { t } = useTranslation(language);

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

  const validateSize = useCallback((size: number) => {
    if (size > MAX_FILE_SIZE) {
      toast.error(t('error.fileTooLarge'));
      return false;
    }
    return true;
  }, [t]);

  const handleImageUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => {
      if (!validateSize(f.size)) return;
      const r = new FileReader();
      r.onloadend = () => {
        const result = r.result as string;
        if (result?.startsWith('data:')) {
          setImages(p => [...p, result]);
        }
      };
      r.readAsDataURL(f);
    });
  }, [validateSize]);

  const handleFileUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => {
      if (!validateSize(f.size)) return;
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
  }, [validateSize]);

  const handleTauriImageUpload = useCallback(async () => {
    if (!checkIsTauri()) return;
    const selected = await dialog.open({
      multiple: true,
      filters: [{ name: t('chat.images'), extensions: IMAGE_EXTENSIONS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const data = await fs.readFile(filePath);
      if (!data) continue;
      if (!validateSize(data.byteLength)) continue;
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
      const mime = mimeFromExtension(filePath);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
      setImages(p => [...p, `data:${mime};base64,${base64}`]);
    }
  }, [validateSize, t]);

  const handleTauriFileUpload = useCallback(async () => {
    if (!checkIsTauri()) return;
    const selected = await dialog.open({
      multiple: true,
      filters: [{ name: t('common.files'), extensions: ['*'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const content = await fs.readTextFile(filePath);
      if (content === null) continue;
      if (!validateSize(new Blob([content]).size)) continue;
      const name = fileNameFromPath(filePath);
      const mime = mimeFromExtension(filePath);
      setFiles(p => [...p, {
        name,
        size: new Blob([content]).size,
        type: mime,
        content,
      }]);
    }
  }, [validateSize, t]);

  return {
    images,
    files,
    handleImageUpload,
    handleFileUpload,
    handleTauriImageUpload,
    handleTauriFileUpload,
    removeImage,
    removeFile,
    clearAttachments
  };
}