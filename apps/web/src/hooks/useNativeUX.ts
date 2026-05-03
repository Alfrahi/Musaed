'use client';

import { useEffect } from 'react';

/**
 * Prevents standard web behaviors that break the desktop native illusion.
 */
function isInsideDragChromeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-tauri-drag-region]'));
}

export function useNativeUX() {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow context menu only in development for debugging
      if (process.env.NODE_ENV === 'production') {
        e.preventDefault();
      }
    };

    const handleDragOver = (e: DragEvent) => {
      // Prevent browser-style navigation on dropped files if not explicitly handled
      if (isInsideDragChromeTarget(e.target)) {
        e.preventDefault();
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (isInsideDragChromeTarget(e.target)) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);
}
