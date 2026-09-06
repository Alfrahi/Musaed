'use client';

import { useCallback, useRef } from 'react';
import { useContextMenu } from '@/hooks/useContextMenu';

/**
 * Context menu wiring for a message bubble. Extracted to keep MessageBubble
 * under the max-lines-per-function lint gate.
 */
export function useMessageContextMenu(
  handleCopy: (overrideText?: string) => void,
  msgId: string,
  onRegenerate: ((msgId: string) => void) | undefined,
  onDelete: (() => void) | undefined,
  t: (key: string) => string
) {
  // Selection captured when the menu opens, so Copy honors an in-bubble
  // selection instead of always copying the whole message.
  const selectedTextRef = useRef('');
  const { showContextMenu } = useContextMenu({
    onCopy: () => handleCopy(selectedTextRef.current || undefined),
    onRegenerate: onRegenerate ? () => onRegenerate(msgId) : undefined,
    onDelete,
  });
  return useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const selection = window.getSelection();
      selectedTextRef.current =
        selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)
          ? selection.toString()
          : '';
      showContextMenu('message', e.clientX, e.clientY, {
        copy: t('contextMenu.message.copy'),
        regenerate: t('contextMenu.message.regenerate'),
        delete: t('contextMenu.message.delete'),
      });
    },
    [showContextMenu, t]
  );
}
