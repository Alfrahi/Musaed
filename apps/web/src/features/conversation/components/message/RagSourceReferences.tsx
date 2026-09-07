'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SourceReference, TranslateFn } from './types';
import { CitationChip } from './CitationChip';

const SOURCE_OVERFLOW_CAP = 5;

export interface RagSourceReferencesProps {
  sources: SourceReference[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenSource: (source: SourceReference) => void;
  t: TranslateFn;
}

/** Renders the RAG source references section. Citations are buttons
 *  and the section is expanded by default when sources are present so the
 *  grounding is visible without an extra interaction. */
export const RagSourceReferences = ({
  sources,
  isExpanded,
  onToggleExpand,
  onOpenSource,
  t,
}: RagSourceReferencesProps) => {
  const visibleSources = isExpanded ? sources.slice(0, SOURCE_OVERFLOW_CAP) : [];
  const hiddenCount = sources.length - SOURCE_OVERFLOW_CAP;
  const hasOverflow = hiddenCount > 0;
  const [showAll, setShowAll] = useState(false);

  const renderCitations = () => {
    if (!isExpanded) return null;
    const list = showAll ? sources : visibleSources;
    return (
      <div className="text-caption mbs-2 space-y-2">
        {list.map((source, index) => (
          <CitationChip key={index} source={source} onOpen={onOpenSource} t={t} />
        ))}
        {hasOverflow && !showAll && (
          <Button
            variant="ghost"
            onClick={() => setShowAll(true)}
            className="text-muted-foreground hover:text-foreground text-caption ms-2 h-auto p-0 font-medium underline-offset-2 hover:bg-transparent hover:underline"
          >
            {t('a11y.showNMoreSources', { count: hiddenCount })}
          </Button>
        )}
        {hasOverflow && showAll && (
          <Button
            variant="ghost"
            onClick={() => setShowAll(false)}
            className="text-muted-foreground hover:text-foreground text-caption ms-2 h-auto p-0 font-medium underline-offset-2 hover:bg-transparent hover:underline"
          >
            {t('a11y.showFewerSources')}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="mbs-4 border-bs pbs-4">
      <Button
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-auto p-0 hover:bg-transparent"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
      >
        <FileText className="h-3 w-3" />
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {t('rag.sourceReferenceCount', { count: sources.length })}
      </Button>
      {renderCitations()}
    </div>
  );
};
