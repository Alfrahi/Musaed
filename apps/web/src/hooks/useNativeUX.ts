"use client";

import { useEffect } from 'react';

function isInsideDragChromeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("[data-tauri-drag-region]"));
}

export function useNativeUX() {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (process.env.NODE_ENV === 'production') {
        e.preventDefault();
      }
    };

    const handleDragOver = (e: DragEvent) => {
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