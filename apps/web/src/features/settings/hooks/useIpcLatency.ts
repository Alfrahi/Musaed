'use client';

import { useState, useEffect, useCallback } from 'react';
import { ipcStats, snapshotIpcStats, resetIpcStats, type IpcStats } from '@/lib/ipc';

/**
 * Hook returning a periodically-refreshed snapshot of IPC perf counters.
 *
 * The IPC bridge mutates `ipcStats` directly when a call completes. This hook
 * exposes a copy so React can re-render subscribers safely and isolates the
 * UI from accidental mutation.
 *
 * @param intervalMs - Refresh cadence in milliseconds (default 2000 ms).
 * @returns Snapshot + a `reset` callback that clears the counters.
 */
export function useIpcLatencyStats(intervalMs = 2000): {
  stats: IpcStats;
  reset: () => void;
} {
  const [stats, setStats] = useState<IpcStats>(() => snapshotIpcStats());

  useEffect(() => {
    const handle = setInterval(() => {
      setStats(snapshotIpcStats());
    }, intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);

  const reset = useCallback(() => {
    resetIpcStats();
    setStats(snapshotIpcStats());
  }, []);

  return { stats, reset };
}

/**
 * Returns the live `ipcStats` reference without reactivity. Useful in tests
 * and for places that want to assert counters directly without depending on
 * the polling cadence.
 */
export { ipcStats };
