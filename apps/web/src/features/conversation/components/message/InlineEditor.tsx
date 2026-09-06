'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TranslateFn } from './types';

interface InlineEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  t: TranslateFn;
}

export const InlineEditor = ({ initialContent, onSave, onCancel, t }: InlineEditorProps) => {
  const [draft, setDraft] = useState(initialContent);

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="border-sidebar-border focus-ring text-foreground text-body w-full resize-none rounded-md border p-3 leading-relaxed outline-none"
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSave(draft.trim());
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onSave(draft.trim())} aria-label={t('common.save')}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} aria-label={t('common.cancel')}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};
