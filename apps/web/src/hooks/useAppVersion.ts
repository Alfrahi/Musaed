'use client';

import { useEffect, useState } from 'react';
import { appApi } from '@/lib/ipc';

/**
 * Module-scoped cache so the version is fetched exactly once per frontend
 * session. Multiple `useAppVersion()` callers share the same promise.
 *
 * Stored as `string | null`:
 *  - `string`   — fetched version (the canonical string from tauri.conf.json)
 *  - `null`     — fetch failed or not running inside Tauri
 *  - `undefined` — fetch has not been attempted yet
 */
let cachedVersion: string | null | undefined = undefined;
let pendingPromise: Promise<string | null> | null = null;

async function fetchVersion(): Promise<string | null> {
  if (cachedVersion !== undefined) return cachedVersion;
  if (pendingPromise) return pendingPromise;
  pendingPromise = (async () => {
    const version = await appApi.getVersion();
    cachedVersion = version;
    pendingPromise = null;
    return version;
  })();
  return pendingPromise;
}

/**
 * Returns the canonical application version sourced from `tauri.conf.json`.
 *
 * The fetch happens once per session and is shared across all callers via a
 * module-scoped cache. On any failure (including running outside Tauri), the
 * returned value degrades to `null` rather than a hardcoded fallback, so the
 * UI never silently shows a drifted version string.
 *
 * @returns `{ version: string | null, isLoading: boolean }`
 */
export function useAppVersion() {
  const [version, setVersion] = useState<string | null>(
    cachedVersion === undefined ? null : cachedVersion
  );
  const [isLoading, setIsLoading] = useState<boolean>(cachedVersion === undefined);

  useEffect(() => {
    if (cachedVersion !== undefined) {
      setVersion(cachedVersion);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    fetchVersion().then((v) => {
      if (!active) return;
      setVersion(v);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return {
    /** Canonical version string from tauri.conf.json, or `null` if unavailable. */
    version,
    /** True while the one-shot fetch is in progress. */
    isLoading,
  };
}
