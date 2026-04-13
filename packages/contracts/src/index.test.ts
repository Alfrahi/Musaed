import { describe, it, expect } from 'vitest';
import { 
  OllamaModelSchema, 
  MessageSchema, 
  ChatSettingsSchema, 
  DEFAULT_SETTINGS,
  sanitizeError,
  BackendErrorCode,
  stripRedactedThinkingBlocks,
  PullErrorSchema,
  REDACTED_THINKING_TAG_START,
  REDACTED_THINKING_TAG_END
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
        parameter_size: '8B',
        quantization_level: 'Q4_0'
      }
    };
    expect(OllamaModelSchema.safeParse(validModel).success).toBe(true);
  });

  it('validates a message structure', () => {
    const validMessage = {
      id: '1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now()
    };
    expect(MessageSchema.safeParse(validMessage).success).toBe(true);
  });

  it('validates default chat settings', () => {
    expect(ChatSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('Contracts: Error Handling', () => {
  it('sanitizes errors and redacts sensitive paths', () => {
    const rawError = {
      code: 'FILE_SYSTEM_ERROR',
      message: 'Failed to access C:\\Users\\Admin\\AppData\\Local\\Musaed'
    };
    const sanitized = sanitizeError(rawError);
    expect(sanitized.code).toBe(BackendErrorCode.FileSystemError);
    expect(sanitized.message).toContain('[PATH REDACTED]');
  });

  it('handles generic string errors', () => {
    const sanitized = sanitizeError('Something exploded');
    expect(sanitized.code).toBe(BackendErrorCode.Unknown);
    expect(sanitized.message).toBe('Something exploded');
  });
});

describe('Contracts: thinking blocks & pull errors', () => {
  it('strips redacted thinking blocks for export parity', () => {
    const inner = 'secret';
    const raw = `Hello ${REDACTED_THINKING_TAG_START}${inner}${REDACTED_THINKING_TAG_END} world`;
    const out = stripRedactedThinkingBlocks(raw);
    expect(out).not.toContain(inner);
    expect(out).not.toContain(REDACTED_THINKING_TAG_START);
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('validates pull-error payloads', () => {
    expect(
      PullErrorSchema.safeParse({ name: 'm', error: 'x', duration: 1 }).success
    ).toBe(true);
  });
});