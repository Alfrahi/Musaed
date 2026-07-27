'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { checkIsTauri } from '@/lib/ipc';

/**
 * Distinguishes image files from other files by extension.
 * Mirrors the IMAGE_EXTENSIONS set in useAttachmentUtils.ts so the same
 * classification logic applies to both the file-picker button and drag-drop.
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export interface DroppedFiles {
  imagePaths: string[];
  filePaths: string[];
}

interface UseDropZoneOptions {
  onDrop: (files: DroppedFiles) => void;
}

/**
 * Listens for Tauri-native drag-and-drop events on the current webview.
 *
 * STANDARDS §16 — filesystem only via Rust. This hook uses Tauri's
 * `onDragDropEvent` which provides file *paths* (not browser File objects),
 * so the frontend never reads file content directly. The paths are handed
 * off to the existing `handleTauriFileUploadInternal` /
 * `handleTauriImageUploadInternal` pipeline which reads content through
 * the IPC `fs` bridge.
 *
 * Returns `isDragOver` so the consumer can render a drop-zone highlight.
 */
export function useDropZone({ onDrop }: UseDropZoneOptions) {
  const [isDragOver, setIsDragOver] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!checkIsTauri()) return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        switch (event.payload.type) {
          case 'enter':
          case 'over':
            setIsDragOver(true);
            break;
          case 'drop': {
            setIsDragOver(false);
            const paths = event.payload.paths;
            if (paths.length === 0) return;

            const imagePaths: string[] = [];
            const filePaths: string[] = [];
            for (const p of paths) {
              if (isImagePath(p)) {
                imagePaths.push(p);
              } else {
                filePaths.push(p);
              }
            }
            onDropRef.current({ imagePaths, filePaths });
            break;
          }
          case 'leave':
            setIsDragOver(false);
            break;
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, []);

  return { isDragOver };
}
