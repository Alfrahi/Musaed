"use client";

import { X, FileText } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useLanguage } from '../../../store/hooks';
import { FileAttachment } from '../hooks/useAttachmentManager';
import { attachmentImageSrc } from '../imageAttachment';

interface AttachmentPreviewProps {
  images: string[];
  files: FileAttachment[];
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
}

const AttachmentPreview = ({ images, files, onRemoveImage, onRemoveFile }: AttachmentPreviewProps) => {
  const language = useLanguage();
  const { t, formatFileSize } = useTranslation(language);

  if (images.length === 0 && files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mbe-2 p-2 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
      {images.map((img, idx) => (
        <div key={`img-${idx}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700 shadow-sm">
          <img src={attachmentImageSrc(img)} alt={t('common.preview')} className="w-full h-full object-cover" />
          <button
            onClick={() => onRemoveImage(idx)}
            className="absolute inset-bs-0.5 inset-ie-0.5 p-0.5 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {files.map((file, idx) => (
        <div key={`file-${idx}`} className="relative flex items-center gap-2 p-2 pe-8 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700 shadow-sm min-w-[120px] max-w-[200px]">
          <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-md shrink-0">
            <FileText size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold truncate dark:text-zinc-200">{file.name}</p>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest">{formatFileSize(file.size)}</p>
          </div>
          <button
            onClick={() => onRemoveFile(idx)}
            className="absolute inset-bs-1 inset-ie-1 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AttachmentPreview;