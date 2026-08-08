import { type BackendError, BackendErrorCode } from '../errors';

/**
 * Sanitizes errors by redacting sensitive system paths, URLs, and stack traces
 * while ensuring type safety. Prevents information leakage from backend errors.
 */
export const sanitizeError = (error: unknown): BackendError => {
  let message = 'An unknown error occurred';
  let code = BackendErrorCode.Unknown;
  let requestId: string | undefined;
  let context: string | undefined;
  let isRetryable = false;

  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error !== null && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;

    if (typeof errObj.message === 'string') {
      message = errObj.message;
    }

    if (typeof errObj.code === 'string') {
      code = errObj.code as BackendErrorCode;
    }

    const rid = errObj.requestId;
    if (typeof rid === 'string') {
      requestId = rid;
    }

    // Preserve structured context and retryability from backend errors so
    // downstream callers can branch on it; only fall back to null/false
    // when the source error does not carry these fields.
    const ctx = errObj.context;
    if (typeof ctx === 'string') {
      context = ctx;
    }

    if (typeof errObj.isRetryable === 'boolean') {
      isRetryable = errObj.isRetryable;
    }
  }

  // Redact URLs, but preserve localhost URLs for debugging
  const urlRegex = /https?:\/\/(?!localhost)[^\s]+/gi;
  message = message.replace(urlRegex, '[URL REDACTED]');

  const dbRegex = /(mongodb|postgres|mysql|redis):\/\/[^\s]+/gi;
  message = message.replace(dbRegex, '[CONNECTION STRING REDACTED]');

  // Redact sensitive patterns (API keys, private IPs, stack locations) before generic path redaction
  const sensitivePatterns: Array<[RegExp, string]> = [
    // API keys/tokens (allow trailing non‑space characters)
    [
      /(api[_-]?key|token|secret|password|passwd|pwd)[:=]\s*[\"']?[\w-]{8,}[^\s]*/gi,
      '$1=[REDACTED]',
    ],
    // Private IPs (exclude localhost)
    [
      /(?:10\\.\\d{1,3}|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}(?::\\d+)?/g,
      '[PRIVATE IP REDACTED]',
    ],
    // Stack trace locations (File/at patterns)
    [/File\s+\"[^\"]+\"\s*,?\s*line\s+\d+(?:,\s*col(?:umn)?\s+\d+)?/gi, '[LOCATION REDACTED]'],
    [/at\s+File\s+[\"'][^\"']+[\"']:\d+:\d+/gi, '[LOCATION REDACTED]'],
  ];

  for (const [pattern, replacement] of sensitivePatterns) {
    message = message.replace(pattern, replacement);
  }

  // Redact any remaining IP addresses (including private ranges) – exclude localhost
  const ipRegex = /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g;
  message = message.replace(ipRegex, '[PRIVATE IP REDACTED]');

  // Redact filesystem paths (Unix, Windows, generic)
  const unixPathRegex =
    /\/(?:home|root|etc|usr|var|opt|srv|tmp|mnt|proc|sys|dev|boot|lib|bin|sbin|Applications?|Users?)[^\s]*/gi;
  message = message.replace(unixPathRegex, '[PATH REDACTED]');

  const winPathRegex = /[A-Za-z]:\\(?:[^\\\\s]+\\)*[^\\\\s]*/g;
  message = message.replace(winPathRegex, '[PATH REDACTED]');

  const genericPathRegex = /([a-zA-Z]:\\(?:[^\\\\s]+\\)+|(?:\/[^\/\\s]+)+\/)/g;
  message = message.replace(genericPathRegex, '[PATH REDACTED]');

  // Normalize whitespace and trim
  message = message.replace(/\s+/g, ' ').trim();

  // Apply the same redaction pipeline to `context` so backend-provided
  // context strings cannot leak sensitive paths/IPs/keys through a field
  // the previous sanitizer left untouched.
  if (context) {
    context = context.replace(urlRegex, '[URL REDACTED]');
    context = context.replace(dbRegex, '[CONNECTION STRING REDACTED]');
    for (const [pattern, replacement] of sensitivePatterns) {
      context = context.replace(pattern, replacement);
    }
    context = context.replace(ipRegex, '[PRIVATE IP REDACTED]');
    context = context.replace(unixPathRegex, '[PATH REDACTED]');
    context = context.replace(winPathRegex, '[PATH REDACTED]');
    context = context.replace(genericPathRegex, '[PATH REDACTED]');
    context = context.replace(/\s+/g, ' ').trim();
  }

  // Fallback for empty messages
  if (!message || message.length < 2) {
    message = 'An error occurred. Please try again.';
  }

  return {
    code,
    message,
    requestId,
    context,
    isRetryable,
  };
};
