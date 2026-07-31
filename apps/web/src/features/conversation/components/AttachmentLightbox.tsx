'use client';

import { X } from 'lucide-react';
import Image from 'next/image';
import { ModalLayout } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store';
import { attachmentImageSrc } from '../image-attachment';

/**
 * Full-screen lightbox for image attachments.
 *
 * Owned by the `conversation` feature. Both consumers
 * (`MessageBubble`, `AttachmentPreview`) live inside `conversation`, so this
 * is an intra-feature import — no cross-feature boundary is crossed.
 */

interface AttachmentLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  /** The image data URL to display. */
  imageSrc: string;
  /** Alt text for the image. */
  alt?: string;
}

const AttachmentLightbox = ({ isOpen, onClose, imageSrc, alt = '' }: AttachmentLightboxProps) => {
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);

  if (!isOpen) return null;

  const resolvedSrc = attachmentImageSrc(imageSrc);

  return (
    <ModalLayout
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-[90vw]"
      className="flex max-h-[90vh] flex-col"
    >
      <div className="relative flex items-center justify-center bg-black/90 p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute end-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          aria-label={t('a11y.closePreview')}
        >
          <X size={20} />
        </Button>
        <Image
          src={resolvedSrc}
          alt={alt}
          width={1200}
          height={900}
          unoptimized
          className="max-h-[85vh] max-w-full object-contain"
        />
      </div>
    </ModalLayout>
  );
};

export default AttachmentLightbox;
