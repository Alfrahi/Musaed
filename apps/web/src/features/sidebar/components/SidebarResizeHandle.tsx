'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '@/store/settings-store';

/**
 * Draggable resize handle for the sidebar.
 *
 * Clamps width between 200–400 px, persists the value in the settings store
 * (`globalSettings.sidebarWidth`), and respects RTL by using logical CSS
 * properties so the handle stays on the correct edge.
 */
const SidebarResizeHandle = () => {
  const sidebarWidth = useSettingsStore((s) => s.globalSettings.sidebarWidth);
  const setGlobalSettings = useSettingsStore((s) => s.setGlobalSettings);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  // Keep a ref to the latest global settings so the mousemove/keydown
  // handlers can spread them without calling getState() (which is hard to
  // mock in tests).
  const settingsRef = useRef(useSettingsStore.getState().globalSettings);
  useEffect(() => {
    settingsRef.current = useSettingsStore.getState().globalSettings;
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [sidebarWidth]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const isRtl = document.documentElement.dir === 'rtl';
      const adjustedDelta = isRtl ? -delta : delta;
      const newWidth = clamp(200, 400, startWidth.current + adjustedDelta);
      setGlobalSettings({
        ...settingsRef.current,
        sidebarWidth: newWidth,
      });
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [setGlobalSettings]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={200}
      aria-valuemax={400}
      aria-valuenow={sidebarWidth}
      aria-label="Resize sidebar"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const isRtl = document.documentElement.dir === 'rtl';
          const direction =
            (e.key === 'ArrowRight' && !isRtl) || (e.key === 'ArrowLeft' && isRtl) ? 1 : -1;
          const newWidth = clamp(200, 400, sidebarWidth + direction * step);
          setGlobalSettings({
            ...settingsRef.current,
            sidebarWidth: newWidth,
          });
        }
      }}
      className="hover:bg-sidebar-border/50 relative w-1 shrink-0 cursor-col-resize transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none"
    />
  );
};

/** Clamp a value between min and max. */
function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

export default SidebarResizeHandle;
