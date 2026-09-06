'use client';

import { useState, useCallback, useMemo } from 'react';
import type { Message } from '@musaed/contracts';
import { useMessageActions } from './useMessageActions';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { type MessageBubbleProps, type SourceReference } from '../components/message/types';
import { useInlineEdit } from './useInlineEdit';
import { useMessageDelete } from './useMessageDelete';

/**
 * Builds the memoized `MessageBubbleBody` props. Extracted so `MessageBubble`
 * stays under the `max-lines-per-function` lint gate (STANDARDS §11) while
 * keeping `bodyProps` stable across renders — the inline callbacks
 * (`onToggleExpand`/`onOpenSource`/`onImageClick`) are `useCallback`'d and the
 * object is `useMemo`'d so the memoized body skips re-render on content churn
 * (React H4).
 */
export const useMessageBubbleState = (
  message: Message,
  onEditMessage: MessageBubbleProps['onEditMessage'],
  onDeleteMessage: MessageBubbleProps['onDeleteMessage']
) => {
  const isUser = message.role === 'user';
  const { copied, handleCopy, tps } = useMessageActions(message);
  const sourceReferences = useMemo(
    () => (message.ragSources ?? []) as SourceReference[],
    [message.ragSources]
  );
  const [isExpanded, setIsExpanded] = useState(sourceReferences.length > 0);
  const [openSource, setOpenSource] = useState<SourceReference | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const { isEditing, startEdit, cancelEdit, saveEdit } = useInlineEdit(message.id, onEditMessage);
  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const handleDelete = useMessageDelete(message.id, onDeleteMessage, t);
  const isStopped = message.stopped === true && message.role === 'assistant';

  const onToggleExpand = useCallback(() => setIsExpanded((prev) => !prev), []);
  const onOpenSource = useCallback((source: SourceReference) => setOpenSource(source), []);
  const onImageClick = useCallback((src: string) => setLightboxImage(src), []);

  return {
    isUser,
    isStopped,
    isEditing,
    sourceReferences,
    isExpanded,
    openSource,
    setOpenSource,
    lightboxImage,
    setLightboxImage,
    startEdit,
    saveEdit,
    cancelEdit,
    onToggleExpand,
    onOpenSource,
    onImageClick,
    tps,
    copied,
    handleCopy,
    handleDelete,
    t,
  };
};
