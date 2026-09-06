'use client';

import { X } from 'lucide-react';
import ModalLayout from '@/components/ui/ModalLayout';
import { Button } from '@/components/ui/button';
import { FileChunkViewer } from '@/features/rag';
import type { SourceReference, TranslateFn } from './types';

export interface SourceViewerModalProps {
  source: SourceReference;
  titleId: string;
  onClose: () => void;
  t: TranslateFn;
}

export const SourceViewerModal = ({ source, titleId, onClose, t }: SourceViewerModalProps) => (
  <ModalLayout isOpen onClose={onClose} titleId={titleId} maxWidth="max-w-3xl" className="h-[80vh]">
    <div className="flex h-full flex-col">
      <div className="border-sidebar-border border-be flex items-center justify-between px-4 py-3">
        <h2 id={titleId} className="text-body truncate font-medium">
          {source.filePath}:{source.startLine}–{source.endLine}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('a11y.closeModal')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileChunkViewer filePath={source.filePath} targetStartLine={source.startLine} />
      </div>
    </div>
  </ModalLayout>
);
