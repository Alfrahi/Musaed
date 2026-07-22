'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getIpcViolations,
  subscribeIpcViolations,
  resetIpcViolations,
  type IpcViolationRecord,
} from '@/lib/ipc';

/**
 * React hook that subscribes to the in-process IPC violation history
 * and re-renders whenever a new violation is dispatched to the trace
 * pipeline.
 *
 * The hook mirrors the polling-free subscription pattern: the IPC
 * bridge notifies subscribers on every mutation of
 * `ipcViolationHistory`, so the UI only re-renders when there is new
 * data — never on a fixed cadence.
 *
 * @returns Snapshot of violations + a `reset` callback that clears
 *          both the live counters and the violation history.
 */
export function useIpcViolations(): {
  violations: IpcViolationRecord[];
  reset: () => void;
} {
  const [violations, setViolations] = useState<IpcViolationRecord[]>(() => getIpcViolations());

  useEffect(() => {
    const unsubscribe = subscribeIpcViolations(() => {
      setViolations(getIpcViolations());
    });
    // Sync once on mount in case violations arrived before subscribe.
    setViolations(getIpcViolations());
    return unsubscribe;
  }, []);

  const reset = useCallback(() => {
    resetIpcViolations();
    setViolations(getIpcViolations());
  }, []);

  return { violations, reset };
}
