import { describe, it, expect } from 'vitest';
import {
  OllamaModelSchema,
  MessageSchema,
  ChatSettingsSchema,
  DEFAULT_SETTINGS,
  sanitizeError,
  BackendErrorCode,
  IpcError,
  stripThinkingBlocks,
  stripRedactedThinkingBlocks,
  findThinkingTags,
  PullErrorSchema,
  ModelValidationSchema,
  REDACTED_THINKING_TAG_START,
  REDACTED_THINKING_TAG_END,
  THINK_TAG_START,
  THINK_TAG_END,
  THINKING_STRIP_TEST_CASES,
} from './index';

describe('Contracts: Zod Schemas', () => {
  it('validates a correct Ollama model', () => {
    const validModel = {
      name: 'llama3:latest',
      size: 1024,
      digest: 'sha256:123',
      details: {
        format: 'gguf',
        family: 'llama',
        parameterSize: '8B',
        quantizationLevel: 'Q4_0',
      },
    };
    expect(OllamaModelSchema.safeParse(validModel).success).toBe(true);
  });

  it('validates a ModelValidation with defaultParams populated', () => {
    const validation = {
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 8192,
      defaultParams: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: 8192,
        numPredict: -1,
      },
    };
    const parsed = ModelValidationSchema.safeParse(validation);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.defaultParams?.numPredict).toBe(-1);
      expect(parsed.data.defaultParams?.temperature).toBe(0.7);
    }
  });

  it('validates a ModelValidation with defaultParams null (Modelfile absent)', () => {
    const validation = {
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: null,
      defaultParams: null,
    };
    expect(ModelValidationSchema.safeParse(validation).success).toBe(true);
  });

  it('validates a ModelValidation with partial defaultParams (some fields null)', () => {
    const validation = {
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 4096,
      defaultParams: {
        temperature: null,
        topP: 0.95,
        topK: null,
        numCtx: null,
        numPredict: 2048,
      },
    };
    const parsed = ModelValidationSchema.safeParse(validation);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.defaultParams?.topP).toBe(0.95);
      expect(parsed.data.defaultParams?.temperature).toBeNull();
    }
  });

  it('rejects a ModelValidation with negative numCtx in defaultParams', () => {
    const validation = {
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: null,
      defaultParams: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        numCtx: -1024, // nonnegative() should reject
        numPredict: 2048,
      },
    };
    expect(ModelValidationSchema.safeParse(validation).success).toBe(false);
  });

  it('accepts a ModelValidation without defaultParams key (back-compat)', () => {
    // Older Rust responses (pre-feature) would not include defaultParams at
    // all; the schema treats it as nullish so older payloads still parse.
    const validation = {
      isValid: true,
      modelName: 'llama3',
      details: null,
      contextLength: 4096,
    };
    const parsed = ModelValidationSchema.safeParse(validation);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.defaultParams).toBeUndefined();
    }
  });

  it('validates a message structure', () => {
    const validMessage = {
      id: '1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    };
    expect(MessageSchema.safeParse(validMessage).success).toBe(true);
  });

  it('validates a message with an `error` field', () => {
    const messageWithError = {
      id: 'm1',
      role: 'assistant',
      content: 'partial response',
      timestamp: Date.now(),
      error: { code: 'STREAM_FAILED', message: 'Ollama went away' },
    };
    expect(MessageSchema.safeParse(messageWithError).success).toBe(true);
    const parsed = MessageSchema.safeParse(messageWithError);
    if (parsed.success) {
      expect(parsed.data.error).toEqual({ code: 'STREAM_FAILED', message: 'Ollama went away' });
    }
  });

  it('treats `error` as optional on the Message schema', () => {
    const messageWithoutError = {
      id: 'm2',
      role: 'user',
      content: 'hi',
      timestamp: Date.now(),
    };
    const parsed = MessageSchema.safeParse(messageWithoutError);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toBeUndefined();
    }
  });

  it('rejects a malformed `error` value on the Message schema', () => {
    const malformed = {
      id: 'm3',
      role: 'assistant',
      content: 'x',
      timestamp: Date.now(),
      error: { code: 123, message: 'oops' },
    };
    expect(MessageSchema.safeParse(malformed).success).toBe(false);
  });

  it('validates a message with a `stopped` field', () => {
    const messageWithStopped = {
      id: 'm4',
      role: 'assistant',
      content: 'partial response',
      timestamp: Date.now(),
      stopped: true,
    };
    expect(MessageSchema.safeParse(messageWithStopped).success).toBe(true);
    const parsed = MessageSchema.safeParse(messageWithStopped);
    if (parsed.success) {
      expect(parsed.data.stopped).toBe(true);
    }
  });

  it('treats `stopped` as optional on the Message schema', () => {
    const messageWithoutStopped = {
      id: 'm5',
      role: 'user',
      content: 'hi',
      timestamp: Date.now(),
    };
    const parsed = MessageSchema.safeParse(messageWithoutStopped);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.stopped).toBeUndefined();
    }
  });

  it('validates default chat settings', () => {
    expect(ChatSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('Contracts: Error Handling', () => {
  it('sanitizes errors and redacts sensitive paths', () => {
    const rawError = {
      code: 'FILE_SYSTEM_ERROR',
      message: 'Failed to access C:\\Users\\Admin\\AppData\\Local\\Musaed',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.code).toBe(BackendErrorCode.FileSystemError);
    expect(sanitized.message).toContain('[PATH REDACTED]');
  });

  it('sanitizes Unix-style paths', () => {
    const rawError = {
      code: 'FILE_SYSTEM_ERROR',
      message: 'Failed to access /home/user/project/src/secrets.txt',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[PATH REDACTED]');
    expect(sanitized.message).not.toContain('/home/user');
  });

  it('handles generic string errors', () => {
    const sanitized = sanitizeError('Something exploded');
    expect(sanitized.code).toBe(BackendErrorCode.Unknown);
    expect(sanitized.message).toBe('Something exploded');
  });

  it('redacts API keys and tokens', () => {
    const rawError = {
      message: 'Auth failed: api_key=abc123def456ghij789klm',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[REDACTED]');
    expect(sanitized.message).not.toContain('abc123');
  });

  it('redacts private IP addresses', () => {
    const rawError = {
      message: 'Cannot connect to 192.168.1.100:8080',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[PRIVATE IP REDACTED]');
    expect(sanitized.message).not.toContain('192.168');
  });

  it('preserves localhost for debugging', () => {
    const rawError = {
      message: 'Connected to http://localhost:11434',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('localhost');
  });

  it('redacts external URLs', () => {
    const rawError = {
      message: 'Request to https://api.example.com/v1/users failed',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[URL REDACTED]');
    expect(sanitized.message).not.toContain('api.example.com');
  });

  it('redacts database connection strings', () => {
    const rawError = {
      message: 'DB error: postgres://user:pass@localhost/db',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[CONNECTION STRING REDACTED]');
    expect(sanitized.message).not.toContain('user:pass');
  });

  it('redacts stack trace file locations', () => {
    const rawError = {
      message: 'Error at File "/app/src/handlers/auth.ts", line 42, column 15',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.message).toContain('[LOCATION REDACTED]');
    expect(sanitized.message).not.toContain('auth.ts');
  });

  it('handles empty error messages gracefully', () => {
    const sanitized = sanitizeError({ message: '' });
    expect(sanitized.message).toBe('An error occurred. Please try again.');
  });

  it('normalizes whitespace in error messages', () => {
    const sanitized = sanitizeError({ message: 'Error with extra spaces' });
    expect(sanitized.message).toBe('Error with extra spaces');
  });

  // ── Context / retryability preservation ─────────────────────────────
  // Previously sanitizeError hard-coded `context: null` and
  // `isRetryable: false`, discarding structured fields even when the
  // backend provided them. These tests pin the new behavior: fields
  // present on the source error flow through to the sanitized output.

  it('preserves context string from a structured backend error', () => {
    const rawError = {
      code: BackendErrorCode.RagSearchError,
      message: 'Vector search failed',
      context: 'RAG vector search failed',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.code).toBe(BackendErrorCode.RagSearchError);
    expect(sanitized.context).toBe('RAG vector search failed');
  });

  it('preserves isRetryable flag from a structured backend error', () => {
    const rawError = {
      code: BackendErrorCode.RagIndexError,
      message: 'Ollama timeout during indexing',
      isRetryable: true,
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.isRetryable).toBe(true);
  });

  it('defaults isRetryable to false when source does not provide it', () => {
    // Mirrors the pre-fix default so callers can rely on a stable shape.
    const sanitized = sanitizeError({ message: 'no retry info' });
    expect(sanitized.isRetryable).toBe(false);
    expect(sanitized.context).toBeUndefined();
  });

  it('preserves both context and isRetryable together', () => {
    const rawError = {
      code: BackendErrorCode.OllamaUnavailable,
      message: 'Connection refused',
      context: 'Failed to connect to Ollama server',
      isRetryable: true,
      requestId: 'req-abc-123',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized).toEqual({
      code: BackendErrorCode.OllamaUnavailable,
      message: 'Connection refused',
      context: 'Failed to connect to Ollama server',
      isRetryable: true,
      requestId: 'req-abc-123',
    });
  });

  it('redacts sensitive paths inside preserved context', () => {
    // Context is sanitized through the same pipeline as the message so
    // backend-provided context cannot leak paths that the message
    // redaction would have caught.
    const rawError = {
      message: 'failed',
      context: 'Failed to read /home/user/secret/file.txt',
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.context).toContain('[PATH REDACTED]');
    expect(sanitized.context).not.toContain('/home/user');
  });
});

describe('Contracts: IpcError', () => {
  it('extends Error and carries structured backend fields', () => {
    const err = new IpcError({
      code: BackendErrorCode.RagSearchError,
      message: 'Vector search failed',
      context: 'RAG vector search failed',
      isRetryable: true,
      requestId: 'req-1',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IpcError);
    expect(err.name).toBe('IpcError');
    expect(err.message).toBe('Vector search failed');
    expect(err.code).toBe(BackendErrorCode.RagSearchError);
    expect(err.isRetryable).toBe(true);
    expect(err.context).toBe('RAG vector search failed');
    expect(err.requestId).toBe('req-1');
  });

  it('defaults optional fields to undefined when backend omits them', () => {
    const err = new IpcError({
      code: BackendErrorCode.Unknown,
      message: 'something broke',
      isRetryable: false,
    });
    expect(err.context).toBeUndefined();
    expect(err.requestId).toBeUndefined();
    expect(err.isRetryable).toBe(false);
  });

  it('can be caught with instanceof IpcError in a try/catch', () => {
    try {
      throw new IpcError({
        code: BackendErrorCode.Timeout,
        message: 'request timed out',
        isRetryable: true,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(IpcError);
      if (e instanceof IpcError) {
        expect(e.isRetryable).toBe(true);
        expect(e.code).toBe(BackendErrorCode.Timeout);
      }
    }
  });
});

describe('Contracts: thinking blocks & pull errors', () => {
  it('strips redacted thinking blocks for export parity', () => {
    const inner = 'secret';
    const raw = `Hello ${REDACTED_THINKING_TAG_START}${inner}${REDACTED_THINKING_TAG_END} world`;
    const out = stripThinkingBlocks(raw);
    expect(out).not.toContain(inner);
    expect(out).not.toContain(REDACTED_THINKING_TAG_START);
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('strips think tags (DeepSeek-R1)', () => {
    const inner = 'reasoning content here';
    const raw = `Hello ${THINK_TAG_START}${inner}${THINK_TAG_END} world`;
    const out = stripThinkingBlocks(raw);
    expect(out).not.toContain(inner);
    expect(out).not.toContain(THINK_TAG_START);
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('strips both tag formats in the same content', () => {
    const raw = `prefix ${REDACTED_THINKING_TAG_START}a${REDACTED_THINKING_TAG_END} middle ${THINK_TAG_START}b${THINK_TAG_END} suffix`;
    const out = stripThinkingBlocks(raw);
    expect(out).not.toContain('a');
    expect(out).not.toContain('b');
    expect(out).toContain('prefix');
    expect(out).toContain('middle');
    expect(out).toContain('suffix');
  });

  it('stripRedactedThinkingBlocks is backward-compatible alias', () => {
    const raw = `${REDACTED_THINKING_TAG_START}x${REDACTED_THINKING_TAG_END}y`;
    expect(stripRedactedThinkingBlocks(raw)).toBe('y');
  });

  it('findThinkingTags finds <redacted-thinking> blocks', () => {
    const content = `before${REDACTED_THINKING_TAG_START}thinking${REDACTED_THINKING_TAG_END}after`;
    const match = findThinkingTags(content)!;
    expect(match).not.toBeNull();
    expect(match.tagStart).toBe(6);
    expect(match.contentStart).toBe(6 + REDACTED_THINKING_TAG_START.length);
    expect(match.closeTagLength).toBe(REDACTED_THINKING_TAG_END.length);
    expect(content.substring(match.contentStart, match.contentEnd)).toBe('thinking');
  });

  it('findThinkingTags finds think-tag blocks', () => {
    const content = `before${THINK_TAG_START}reasoning${THINK_TAG_END}after`;
    const match = findThinkingTags(content)!;
    expect(match).not.toBeNull();
    expect(match.closeTagLength).toBe(THINK_TAG_END.length);
    expect(content.substring(match.contentStart, match.contentEnd)).toBe('reasoning');
  });

  it('findThinkingTags returns null when no tags present', () => {
    expect(findThinkingTags('just plain text')).toBeNull();
  });

  it('findThinkingTags handles streaming (no closing tag)', () => {
    const content = `before${THINK_TAG_START}partial reasoning...`;
    const match = findThinkingTags(content)!;
    expect(match).not.toBeNull();
    expect(match.closeTagLength).toBe(-1);
    expect(match.contentEnd).toBe(content.length);
    expect(content.substring(match.contentStart, match.contentEnd)).toBe('partial reasoning...');
  });

  it('prefers <redacted-thinking> over think tags when both are present', () => {
    const content = `${REDACTED_THINKING_TAG_START}a${REDACTED_THINKING_TAG_END}${THINK_TAG_START}b${THINK_TAG_END}`;
    const match = findThinkingTags(content)!;
    expect(content.substring(match.contentStart, match.contentEnd)).toBe('a');
  });

  it('validates pull-error payloads', () => {
    expect(PullErrorSchema.safeParse({ name: 'm', error: 'x', duration: 1 }).success).toBe(true);
  });
});

describe('Contracts: stripThinkingBlocks parity (THINKING_STRIP_TEST_CASES)', () => {
  it.each(THINKING_STRIP_TEST_CASES.map((tc) => [tc.description, tc.input, tc.expected] as const))(
    '%s',
    (_description, input, expected) => {
      expect(stripThinkingBlocks(input)).toBe(expected);
    }
  );
});
