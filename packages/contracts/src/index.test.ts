import { describe, it, expect } from 'vitest';
import {
  OllamaModelSchema,
  MessageSchema,
  ChatSettingsSchema,
  DEFAULT_SETTINGS,
  sanitizeError,
  BackendErrorCode,
  stripThinkingBlocks,
  stripRedactedThinkingBlocks,
  findThinkingTags,
  PullErrorSchema,
  REDACTED_THINKING_TAG_START,
  REDACTED_THINKING_TAG_END,
  THINK_TAG_START,
  THINK_TAG_END,
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
        quantization_level: 'Q4_0',
      },
    };
    expect(OllamaModelSchema.safeParse(validModel).success).toBe(true);
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
    const out = stripThinkingBlocks(raw);
    expect(out).not.toContain(inner);
    expect(out).not.toContain(REDACTED_THINKING_TAG_START);
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('strips <thinkigne...</thinkigne> blocks (DeepSeek-R1)', () => {
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

  it('findThinkingTags finds <thinkigne blocks', () => {
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

  it('prefers <redacted-thinking> over <thinkigne when both are present', () => {
    const content = `${REDACTED_THINKING_TAG_START}a${REDACTED_THINKING_TAG_END}${THINK_TAG_START}b${THINK_TAG_END}`;
    const match = findThinkingTags(content)!;
    expect(content.substring(match.contentStart, match.contentEnd)).toBe('a');
  });

  it('validates pull-error payloads', () => {
    expect(PullErrorSchema.safeParse({ name: 'm', error: 'x', duration: 1 }).success).toBe(true);
  });
});
