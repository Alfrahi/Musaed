'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/store/settings-store';
import { useIsHydrated } from '@/store/hooks';

/** Window width (px) at which the sidebar auto-collapses. */
const AUTO_COLLAPSE_THRESHOLD = 720;

/**
 * Auto-collapse the sidebar when the window narrows below 720px, without
 * clobbering a manual user preference.
 *
 * Semantics:
 * - When the window drops below the threshold AND the sidebar is currently
 *   expanded, collapse it and record that the collapse was auto-initiated
 *   (the ref stores the *reason* of the last auto action, or `null` when
 *   the last action was manual or there was no auto action). This lets a
 *   subsequent manual expand flip the ref back to `null` so a later
 *   re-narrowing can auto-collapse again.
 * - When the window widens back above the threshold, do NOT auto-expand
 *   (auto-expanding is jarring; the user re-expands manually).
 * - A manual action (the user toggling collapse via Cmd+B, the sidebar
 *   expand/collapse buttons, or drag-resize) writes `manual` to the ref
 *   by means of the `useSettingsActions.updateGlobalSettings` path that
 *   those callers go through — but because the ref lives in this hook,
 *   the simplest reliable signal here is "the sidebar was already
 *   collapsed when we shrank below the threshold, so don't retract that".
 *
 * The ref is session-scoped (not persisted) so the auto/manual distinction
 * resets on app restart, matching the prompt's constraint.
 */
export function useAutoCollapseSidebar() {
  const isHydrated = useIsHydrated();
  // Track whether the last collapse/expand was auto-initiated by this hook.
  // `true` = last auto action collapsed; `false` = last auto action expanded;
  // `null` = no auto action yet, or the last action was manual.
  const lastAutoCollapsedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isHydrated) return;

    const mql = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_THRESHOLD}px)`);
    const apply = (isNarrow: boolean) => {
      const { globalSettings, setGlobalSettings } = useSettingsStore.getState();
      const currentlyCollapsed = globalSettings.sidebarCollapsed;

      if (isNarrow && !currentlyCollapsed) {
        // Narrowing while expanded → auto-collapse (only the first time; if
        // the user has since manually re-expanded, `lastAutoCollapsedRef`
        // is `null` so we collapse again — but once we've auto-collapsed,
        // widening then re-narrowing without a manual expand in between
        // won't re-fire because `currentlyCollapsed` is already `true`).
        setGlobalSettings({ ...globalSettings, sidebarCollapsed: true });
        lastAutoCollapsedRef.current = true;
        return;
      }

      // Never auto-expand on widen — the user re-expands manually.
      // When widening, just clear the auto flag so a later re-narrowing
      // can auto-collapse again (the sidebar is currently expanded after a
      // manual expand, so we'll collapse on the next narrow pass).
      if (!isNarrow) {
        lastAutoCollapsedRef.current = null;
      }
    };

    apply(mql.matches);
    const handleChange = (e: MediaQueryListEvent) => apply(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [isHydrated]);
}
