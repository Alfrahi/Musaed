'use client';

import Image from 'next/image';
import { X, FileText } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useSettingsStore } from '../../settings/store/settings-store';
import { type FileAttachment } from '../hooks/useAttachmentUtils';
import { attachmentImageSrc } from '../imageAttachment';

interface AttachmentPreviewProps {
  images: string[];
  files: FileAttachment[];
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
}

const AttachmentPreview = ({
  images,
  files,
  onRemoveImage,
  onRemoveFile,
}: AttachmentPreviewProps) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t, formatFileSize } = useTranslation(language);

  if (images.length === 0 && files.length === 0) return null;

  return (
    <div className="mbe-2 flex flex-wrap gap-2 rounded-xl border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      {images.map((img, idx) => (
        <div
          key={`img-${idx}`}
          className="relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-300 shadow-sm dark:border-zinc-700"
        >
          <Image
            src={attachmentImageSrc(img)}
            alt={t('common.preview')}
            width={64}
            height={64}
            unoptimized
            className="h-full w-full object-cover"
          />
          <button
            onClick={() => onRemoveImage(idx)}
            className="inset-bs-0.5 inset-ie-0.5 absolute rounded-full bg-black/50 p-0.5 text-white transition-colors hover:bg-black/70"
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {files.map((file, idx) => (
        <div
          key={`file-${idx}`}
          className="relative flex max-w-[200px] min-w-[120px] items-center gap-2 rounded-lg border border-zinc-300 bg-white p-2 pe-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <div className="shrink-0 rounded-md bg-blue-50 p-1.5 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
            <FileText size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold dark:text-zinc-200">{file.name}</p>
            <p className="text-[9px] tracking-widest text-zinc-500 uppercase">
              {formatFileSize(file.size)}
            </p>
          </div>
          <button
            onClick={() => onRemoveFile(idx)}
            className="inset-bs-1 inset-ie-1 absolute p-0.5 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default AttachmentPreview;
