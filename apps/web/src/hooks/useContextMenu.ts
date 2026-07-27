'use client';

import { useCallback } from 'react';
import { contextMenuApi } from '@/lib/ipc';
import type { ContextMenuKind } from '@musaed/contracts';

/**
 * Shared hook for native Tauri context-menu dispatch (audit F13, Prompt 12).
 *
 * Returns a `showContextMenu` callback that calls `contextMenuApi.show` with
 * the given kind, target id, and translated labels, then dispatches the
 * selected action through the provided action map.
 *
 * Kept as a shared hook (not feature-scoped) because context menus span three
 * surfaces (conversation rows, message bubbles, code blocks) across two
 * features (sidebar, conversation).
 */
export function useContextMenu(handlers: {
  onRename?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onRegenerate?: () => void;
}) {
  const showContextMenu = useCallback(
    async (
      kind: ContextMenuKind,
      targetId: string,
      x: number,
      y: number,
      labels: Record<string, string>
    ) => {
      const result = await contextMenuApi.show(kind, targetId, x, y, labels);
      if (!result?.selectedItem) return;
      switch (result.selectedItem) {
        case 'rename':
          handlers.onRename?.();
          break;
        case 'export':
          handlers.onExport?.();
          break;
        case 'delete':
          handlers.onDelete?.();
          break;
        case 'copy':
          handlers.onCopy?.();
          break;
        case 'regenerate':
          handlers.onRegenerate?.();
          break;
      }
    },
    [
      handlers.onRename,
      handlers.onExport,
      handlers.onDelete,
      handlers.onCopy,
      handlers.onRegenerate,
    ]
  );

  return { showContextMenu };
}
