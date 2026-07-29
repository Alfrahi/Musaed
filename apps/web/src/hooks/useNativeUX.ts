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

    // The previous global `contextmenu` `preventDefault` in production is gone
    // (audit F13, Prompt 12). Right-click surfaces own their `onContextMenu`
    // handlers now and route through the native Tauri context-menu IPC
    // (`cmd_context_menu_show`). A blanket `preventDefault` here would suppress
    // the platform-native menu on surfaces that have opted into it without
    // repairing anything, so it has been removed. Drag-region preventive
    // behavior still targets `[data-tauri-drag-region]` via
    // `isInsideDragChromeTarget`.
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);
}
