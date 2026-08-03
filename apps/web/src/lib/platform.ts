/**
 * Platform detection utility.
 *
 * Provides stable, SSR-safe platform detection for UI platform-branching
 * (caption-button clearance, shortcut modifier display, etc.).
 *
 * Inside a Tauri webview `navigator.platform` and `navigator.userAgent`
 * reflect the host OS. `navigator.platform` is deprecated but remains
 * the most reliable signal in webview contexts; `navigator.userAgent`
 * is used as a fallback.
 */

type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';

  const platform = navigator.platform?.toUpperCase() ?? '';
  const userAgent = navigator.userAgent?.toUpperCase() ?? '';

  if (platform.includes('MAC') || userAgent.includes('MAC')) return 'mac';
  if (platform.includes('WIN') || userAgent.includes('WIN')) return 'windows';
  if (platform.includes('LINUX') || userAgent.includes('LINUX')) return 'linux';

  return 'unknown';
}

let cachedPlatform: Platform | null = null;

/**
 * Returns the detected platform. Memoised after the first call.
 * Safe to call during SSR (returns `'unknown'`).
 */
export function getPlatform(): Platform {
  if (cachedPlatform === null) {
    cachedPlatform = detectPlatform();
  }
  return cachedPlatform;
}

export function isMac(): boolean {
  return getPlatform() === 'mac';
}

export function isWindows(): boolean {
  return getPlatform() === 'windows';
}

/** @internal Reset the memoised platform — test-only. */
export function __resetPlatformCache(): void {
  cachedPlatform = null;
}
