'use client';

/**
 * App boot orchestrator.
 *
 * Lives in `src/hooks/` (not inside any one feature) because it coordinates
 * multiple features at startup. Per STANDARDS.md §3, no feature may import a
 * sibling feature; an orchestrator that crosses those boundaries by design
 * belongs in the shared `src/hooks/` layer.
 *
 * Each feature exports its own `initialize()` hook so the orchestrator stays
 * thin — it composes per-feature init sequences rather than owning the logic
 * for every domain. See the architecture decision recorded in
 * `apps/web/src/store/coordination.ts`.
 *
 * `HomeClient.tsx` (the layout composition root) is the only consumer; it
 * invokes `initializeApp()` once on mount.
 */
import { useCallback, useRef } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useSetInitialized, useSetUIError } from '@/store/hooks';
import { useSettingsInitialization } from '@/features/settings';
import { useLibraryInitialization } from '@/features/library';
import { useConversationInitialization } from '@/features/conversation';
import { logger } from '@/lib/logger';

export function useAppInitialization() {
  const setInitialized = useSetInitialized();
  const setError = useSetUIError();
  const { initialize: initSettings } = useSettingsInitialization();
  const { initialize: initLibrary } = useLibraryInitialization();
  const { initialize: initConversation } = useConversationInitialization();

  // In-flight guard: the `isInitialized` store check is not atomic, so two
  // concurrent `initializeApp` calls could both pass it before either sets
  // the flag, double-initializing (Senior F5). A synchronous ref set before
  // the first `await` makes the guard re-entrant within a single render.
  const inFlightRef = useRef(false);

  const initializeApp = useCallback(async () => {
    if (inFlightRef.current || useUIStore.getState().isInitialized) return;
    inFlightRef.current = true;

    try {
      await initSettings();
      await initLibrary();
      await initConversation();

      setInitialized(true);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Initialization failed', { error: errorMessage });
      setInitialized(true);
      setError('error.initializationFailed');
    } finally {
      inFlightRef.current = false;
    }
  }, [initSettings, initLibrary, initConversation, setInitialized, setError]);

  return { initializeApp };
}
