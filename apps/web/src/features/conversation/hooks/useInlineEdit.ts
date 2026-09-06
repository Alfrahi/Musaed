'use client';

import { useState, useCallback } from 'react';

/**
 * Inline editor state for a message bubble — toggled on by the Edit button.
 * Extracted to keep MessageBubble under the max-lines-per-function lint gate.
 */
export function useInlineEdit(
  msgId: string,
  onEditMessage?: (msgId: string, newContent: string) => void
) {
  const [isEditing, setIsEditing] = useState(false);

  const startEdit = useCallback(() => setIsEditing(true), []);
  const cancelEdit = useCallback(() => setIsEditing(false), []);
  const saveEdit = useCallback(
    (newContent: string) => {
      setIsEditing(false);
      onEditMessage?.(msgId, newContent);
    },
    [msgId, onEditMessage]
  );

  return { isEditing, startEdit, cancelEdit, saveEdit };
}
