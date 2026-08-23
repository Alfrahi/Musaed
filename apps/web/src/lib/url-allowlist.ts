/**
 * URL security policy — allowlists for Ollama endpoints and the opener plugin.
 *
 * Extracted from `ipc.ts` (Finding 12) to keep the IPC bridge focused on
 * command routing and latency tracking.
 */

/**
 * Validates that a URL points to a permitted local Ollama endpoint.
 * Only allows localhost, loopback addresses, .local domains, and private
 * IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
 *
 * @param url - The URL to validate (full URL string)
 * @returns true if the URL is a permitted local address, false otherwise
 */
export const isValidOllamaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const { hostname } = parsed;
    const isLocal =
      ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local');
    const isPrivateIP = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
    return isLocal || isPrivateIP;
  } catch {
    return false;
  }
};

/**
 * Sanitizes a user-supplied Ollama URL by stripping path, query, and fragment.
 * Returns only scheme + host + port to prevent injection attacks.
 * If URL parsing fails, returns the original string unchanged.
 *
 * @param url - The URL to sanitize
 * @returns A sanitized URL string containing only protocol, host, and optional port
 */
export const sanitizeOllamaUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
};

/**
 * Allowed URL patterns for the opener plugin.
 * Must stay in sync with `src-tauri/capabilities/default.json`.
 */
export const OPENER_ALLOWED_PATTERNS: readonly RegExp[] = [
  /^https:\/\/github\.com\/[Aa]lfrahi\/[Mm]usaed(?:\/.+)?$/,
  /^https:\/\/ollama\.com(?:\/.+)?$/,
  /^https:\/\/ollama\.ai(?:\/.+)?$/,
  /^mailto:/,
];

/**
 * Checks whether a URL matches the opener allowlist. Used by MarkdownRenderer
 * to resolve safe markdown hrefs and by the opener plugin to enforce the same
 * allowlist on click.
 */
export function isOpenerUrlAllowed(url: string): boolean {
  return OPENER_ALLOWED_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Allowed protocols for markdown links rendered in the conversation view.
 * Kept intentionally broad (http/https/mailto) at this layer; the opener
 * plugin narrows to the allowlist patterns above at the click boundary.
 */
export const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Sanitizes an href to only allow safe protocols and return a safe, resolved
 * URL string for rendering as a link. Returns null for unsafe/invalid URLs.
 */
export function resolveAllowedHref(href: string | undefined | null): string | null {
  if (!href?.trim()) return null;

  try {
    const base =
      typeof window !== 'undefined' && window.location?.href
        ? window.location.href
        : 'https://invalid.invalid/';

    const url = new URL(href, base);
    if (ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return url.toString();
  } catch {
    /* Invalid URL -> treat as unsafe */
  }

  return null;
}
