'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { attachmentImageSrc } from '../../image-attachment';
import type { TranslateFn } from './types';

interface MessageImagesProps {
  images: string[];
  onImageClick: (img: string) => void;
  t: TranslateFn;
}

export const MessageImages = ({ images, onImageClick, t }: MessageImagesProps) => {
  const total = images.length;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, idx) => (
        <Button
          key={idx}
          variant="ghost"
          size="icon"
          onClick={() => onImageClick(img)}
          className="h-auto w-auto cursor-zoom-in p-0"
        >
          <Image
            src={attachmentImageSrc(img)}
            alt={
              total > 1
                ? t('chat.userUploadedImageIndexed', { index: idx + 1, total })
                : t('chat.userUploadedImage')
            }
            width={384}
            height={256}
            unoptimized
            className="border-sidebar-border max-h-64 w-auto rounded-md border object-contain"
          />
        </Button>
      ))}
    </div>
  );
};
