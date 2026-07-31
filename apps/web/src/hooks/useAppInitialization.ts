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
 * `apps/web/src/store/coordination.ts` and AUDIT.txt §3.3.
 *
 * `HomeClient.tsx` (the layout composition root) is the only consumer; it
 * invokes `initializeApp()` once on mount.
 */
import { useCallback } from 'react';
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

  const initializeApp = useCallback(async () => {
    if (useUIStore.getState().isInitialized) return;

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
    }
  }, [initSettings, initLibrary, initConversation, setInitialized, setError]);

  return { initializeApp };
}
