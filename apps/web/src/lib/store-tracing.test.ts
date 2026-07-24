import { describe, it, expect, beforeEach, vi } from 'vitest';

// `@/lib/ipc` is globally auto-mocked via vitest.setup.ts using the stubs in
// `src/lib/__mocks__/ipc.ts`. We want the real `traceApi` symbol so that the
// helper under test routes through the spy `traceApi.append` exposed by the
// mock — that lets us assert call shape without wiring up the Rust backend.
import { traceApi } from '@/lib/ipc';
import {
  traceStoreMutation,
  traceAppendToken,
  resetTokenCounter,
  resetStoreTracing,
  __internal,
} from '@/lib/store-tracing';

describe('store-tracing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStoreTracing();
  });

  describe('traceStoreMutation', () => {
    it('emits a structured TraceEntryInput through traceApi.append', () => {
      traceStoreMutation({
        feature: 'conversation',
        action: 'addConversation',
        level: 'INFO',
        message: 'addConversation conv-1',
        context: { conversationId: 'conv-1' },
        throttleMs: 0,
      });

      expect(traceApi.append).toHaveBeenCalledTimes(1);
      const input = (vi.mocked(traceApi.append).mock.calls[0] as unknown[])[0] as Parameters<
        typeof traceApi.append
      >[0];
      expect(input).toMatchObject({
        feature: 'conversation',
        action: 'addConversation',
        level: 'INFO',
        message: 'addConversation conv-1',
        source: 'frontend',
        context: { conversationId: 'conv-1' },
      });
      // Deterministic UUID from window.crypto.randomUUID.
      expect(input.traceId).toBe('00000000-0000-4000-8000-000000000000');
    });

    it('suppresses a second emit within the throttle window', () => {
      traceStoreMutation({
        feature: 'streaming',
        action: 'flushToConversation',
        level: 'DEBUG',
        message: 'first',
        throttleMs: 1000,
      });
      traceStoreMutation({
        feature: 'streaming',
        action: 'flushToConversation',
        level: 'DEBUG',
        message: 'second',
        throttleMs: 1000,
      });

      expect(traceApi.append).toHaveBeenCalledTimes(1);
    });

    it('emits again after the throttle window elapses', () => {
      const realNow = Date.now;
      let t = 0;
      Date.now = () => t;
      try {
        t = 0;
        traceStoreMutation({
          feature: 'streaming',
          action: 'flushToConversation',
          level: 'DEBUG',
          message: 'first',
          throttleMs: 1000,
        });
        t = 999;
        traceStoreMutation({
          feature: 'streaming',
          action: 'flushToConversation',
          level: 'DEBUG',
          message: 'suppressed',
          throttleMs: 1000,
        });
        t = 1001;
        traceStoreMutation({
          feature: 'streaming',
          action: 'flushToConversation',
          level: 'DEBUG',
          message: 'second',
          throttleMs: 1000,
        });
      } finally {
        Date.now = realNow;
      }

      expect(traceApi.append).toHaveBeenCalledTimes(2);
      const secondCall = (vi.mocked(traceApi.append).mock.calls[1] as unknown[])[0] as Parameters<
        typeof traceApi.append
      >[0];
      expect(secondCall).toMatchObject({ message: 'second' });
    });

    it('throttles independently per throttleKeySuffix', () => {
      traceStoreMutation({
        feature: 'message',
        action: 'updateLastMessage',
        level: 'DEBUG',
        message: 'conv-a',
        throttleMs: 1000,
        throttleKeySuffix: 'conv-a',
      });
      traceStoreMutation({
        feature: 'message',
        action: 'updateLastMessage',
        level: 'DEBUG',
        message: 'conv-b',
        throttleMs: 1000,
        throttleKeySuffix: 'conv-b',
      });

      expect(traceApi.append).toHaveBeenCalledTimes(2);
    });

    it('survives a rejection from traceApi.append without throwing', () => {
      vi.mocked(traceApi.append).mockRejectedValueOnce(new Error('boom'));
      expect(() =>
        traceStoreMutation({
          feature: 'streaming',
          action: 'startStream',
          level: 'INFO',
          message: 's',
          throttleMs: 0,
        })
      ).not.toThrow();
    });
  });

  describe('traceAppendToken', () => {
    const N = __internal.TOKEN_TRACE_EVERY_N;

    it('emits only on the Nth token per conversation', () => {
      for (let i = 1; i < N; i++) {
        const emitted = traceAppendToken('conv1', i);
        expect(emitted).toBe(false);
      }
      expect(traceAppendToken('conv1', N)).toBe(true);

      expect(traceApi.append).toHaveBeenCalledTimes(1);
      const input = (vi.mocked(traceApi.append).mock.calls[0] as unknown[])[0] as Parameters<
        typeof traceApi.append
      >[0];
      expect(input).toMatchObject({
        feature: 'streaming',
        action: 'appendToken',
        level: 'DEBUG',
        context: { conversationId: 'conv1', chunkCount: N, tokenIdx: N },
      });
    });

    it('maintains independent counters per conversation', () => {
      for (let i = 1; i < N; i++) traceAppendToken('conv1', i);
      for (let i = 1; i < N; i++) traceAppendToken('conv2', i);
      expect(traceApi.append).toHaveBeenCalledTimes(0);
      expect(traceAppendToken('conv1', N)).toBe(true);
      expect(traceAppendToken('conv2', N)).toBe(true);
      expect(traceApi.append).toHaveBeenCalledTimes(2);
    });

    it('restarts the counter after resetTokenCounter', () => {
      for (let i = 1; i < N; i++) traceAppendToken('conv1', i);
      resetTokenCounter('conv1');
      for (let i = 1; i < N; i++) traceAppendToken('conv1', i);
      expect(traceApi.append).toHaveBeenCalledTimes(0);
      expect(traceAppendToken('conv1', N)).toBe(true);
    });
  });
});
