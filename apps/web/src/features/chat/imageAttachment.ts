/**
 * User message `images[]` may be a full data URL (preserves MIME for UI) or legacy raw base64.
 */
export function attachmentImageSrc(stored: string): string {
  if (stored.startsWith('data:')) return stored;
  return `data:image/png;base64,${stored}`;
}

/** Ollama expects base64 bytes without a data-URL prefix. */
export function toOllamaBase64Image(stored: string): string {
  if (!stored.startsWith('data:')) return stored;
  // Prefer `;base64,` so commas inside URL-encoded SVG payloads are not mistaken for the split.
  const marker = ';base64,';
  const mi = stored.indexOf(marker);
  if (mi !== -1) {
    return stored.slice(mi + marker.length).replace(/\s/g, '');
  }
  const comma = stored.indexOf(',');
  if (comma !== -1) return stored.slice(comma + 1).replace(/\s/g, '');
  return stored;
}
