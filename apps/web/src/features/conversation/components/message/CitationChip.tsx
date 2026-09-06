'use client';

import { FileText } from 'lucide-react';
import type { SourceReference, TranslateFn } from './types';

export interface CitationChipProps {
  source: SourceReference;
  onOpen: (source: SourceReference) => void;
  t: TranslateFn;
}

/** A single citation rendered as a button — clicking mounts the
 *  `FileChunkViewer` modal pre-scrolled to the cited line range. */
export const CitationChip = ({ source, onOpen, t }: CitationChipProps) => {
  const ariaLabel = t('a11y.openSource', {
    file: source.filePath,
    startLine: source.startLine,
    endLine: source.endLine,
  });
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="bg-secondary/50 hover:bg-secondary text-foreground inline-flex cursor-pointer items-start gap-2 rounded-md p-2 text-start transition-colors"
    >
      <FileText className="text-muted-foreground mbs-0.5 h-3 w-3 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {source.filePath}
          <span className="text-muted-foreground ms-1 font-normal">
            (lines {source.startLine}–{source.endLine})
          </span>
        </span>
        {source.language && (
          <span className="text-muted-foreground text-caption block">{source.language}</span>
        )}
      </span>
    </button>
  );
};
