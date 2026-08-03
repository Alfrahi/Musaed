'use client';

import { useState } from 'react';
import Image from 'next/image';
import { X, FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { type FileAttachment } from '@/features/conversation/hooks/useAttachmentUtils';
import { attachmentImageSrc } from '../image-attachment';
import AttachmentLightbox from './AttachmentLightbox';
import { Button } from '@/components/ui/button';

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (images.length === 0 && files.length === 0) return null;

  return (
    <>
      <div className="mbe-2 flex flex-wrap gap-2 rounded-md border border-zinc-200 bg-zinc-100 p-2 dark:border-zinc-800 dark:bg-zinc-900">
        {images.map((img, idx) => (
          <div
            key={`img-${idx}`}
            className="relative h-16 w-16 overflow-hidden rounded-md border border-zinc-300 shadow-sm dark:border-zinc-700"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLightboxIndex(idx)}
              className="h-full w-full cursor-zoom-in rounded-md p-0"
              aria-label={t('common.preview')}
            >
              <Image
                src={attachmentImageSrc(img)}
                alt={t('common.preview')}
                width={64}
                height={64}
                unoptimized
                className="h-full w-full rounded-md object-cover"
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemoveImage(idx)}
              className="inset-bs-0.5 inset-ie-0.5 absolute h-auto min-h-6 w-auto min-w-6 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
            >
              <X size={12} />
            </Button>
          </div>
        ))}

        {files.map((file, idx) => (
          <div
            key={`file-${idx}`}
            className="relative flex max-w-[200px] min-w-[120px] items-center gap-2 rounded-md border border-zinc-300 bg-white p-2 pe-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <div className="shrink-0 rounded-md bg-blue-50 p-1.5 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
              <FileText size={16} />
            </div>
            <div className="min-w-0">
              <p className="caption-xs truncate font-bold dark:text-zinc-200">{file.name}</p>
              <p className="caption-xs tracking-widest text-zinc-500 uppercase">
                {formatFileSize(file.size)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onRemoveFile(idx)}
              className="inset-bs-1 inset-ie-1 absolute h-auto min-h-6 w-auto min-w-6 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={12} />
            </Button>
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <AttachmentLightbox
          isOpen
          onClose={() => setLightboxIndex(null)}
          imageSrc={images[lightboxIndex]}
          alt={t('common.preview')}
        />
      )}
    </>
  );
};

export default AttachmentPreview;
