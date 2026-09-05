// Full chat-stream lifecycle test (Testing §4 gap 1).
//
// This is an integration test at the store boundary: it drives the real
// `useTauriEvents` token handler with a scripted token sequence through the
// REAL streaming-store, message-store, ui-store, and coordination.stopStream
// — mocking only the IPC edge (event listener registration, backend message
// persistence) and pure side effects (logger, auto-title, toasts).
//
// The contract being proven:
//   1. While streaming (done:false), tokens accumulate as raw text in the
//      streaming store's liveContent buffer; the message store's assistant
//      placeholder is NOT touched and never carries done:true.
//   2. When done:true arrives, the buffer is flushed into the assistant
//      message (append mode), the message is marked done and persisted to
//      the backend with the full content + token metrics, the stream is
//      cleared, and the global isStreaming flag is dropped.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

// ---- IPC boundary mocks (hoisted) ------------------------------------------

const { handlerBoxes, mockUnlisten } = vi.hoisted(() => {
  const boxes: Record<string, ((payload: unknown) => void) | null> = {};
  return { handlerBoxes: boxes, mockUnlisten: vi.fn() };
});

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
    handlerBoxes[event] = handler;
    return Promise.resolve(mockUnlisten);
  }),
}));

const mockPersistMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true, retries: 0 })
);

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistMessage: (...args: unknown[]) => mockPersistMessage(...args),
}));

vi.mock('@/features/conversation/hooks/useAutoTitle', () => ({
  triggerAutoTitle: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

vi.mock('@/lib/i18n', () => ({
  translate: vi.fn((key: string) => key),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/store-tracing', () => ({
  traceStoreMutation: vi.fn(),
  traceAppendToken: vi.fn(),
  resetTokenCounter: vi.fn(),
}));

// ---- Real modules under test ------------------------------------------------
// Imported AFTER the mocks so the store wiring (useTauriEvents, coordination,
// streaming-store, message-store, ui-store) is the production implementation.

import type { Message } from '@musaed/contracts';
import { useTauriEvents } from '@/features/conversation/hooks/useTauriEvents';
import { useStreamingStore } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import { useUIStore } from '@/store/ui-store';
import { drainPendingTokenBatch } from '@/lib/token-coalescer';

const CONV_ID = 'conv-life';
const REQUEST_ID = 'req-life-1';

/** Render the hook once (mounts the real event listeners). */
function mountListeners() {
  return render(
    React.createElement(function Harness() {
      useTauriEvents();
      return null;
    })
  );
}

/** Wait until the ollama-token handler has been registered. */
async function waitForTokenHandler() {
  await waitFor(() => {
    expect(handlerBoxes['ollama-token']).not.toBeNull();
  });
}

/** Script a token through the real event handler, async metrics store. */
function emitToken(content: string, done: boolean, requestId: string = REQUEST_ID) {
  handlerBoxes['ollama-token']!({
    requestId,
    message: { role: 'assistant', content },
    done,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(handlerBoxes)) handlerBoxes[key] = null;
  drainPendingTokenBatch();

  // Reset real stores to a pristine per-test baseline.
  useStreamingStore.setState({
    activeStreams: {},
    liveContent: {},
    pendingMetrics: {},
  });

  useMessageStore.setState({ messages: {} });

  useUIStore.getState().setStreaming(false);
});

afterEach(() => {
  drainPendingTokenBatch();
});

/** Seed the message store with a user + empty assistant placeholder pair. */
function seedConversation() {
  const userMsg: Message = {
    id: 'm-user',
    role: 'user',
    content: 'say hi',
    timestamp: 1,
    requestId: 'req-user',
  };
  const assistantMsg: Message = {
    id: 'm-asst',
    role: 'assistant',
    content: '',
    timestamp: 2,
    model: 'llama3',
    requestId: REQUEST_ID,
  };
  useMessageStore.getState().setMessages(CONV_ID, [userMsg, assistantMsg]);
  // Register the active stream (what ChatSendService does before chatApi.chat).
  useStreamingStore.getState().startStream(CONV_ID, REQUEST_ID);
  useUIStore.getState().setStreaming(true);
}

describe('chat-stream lifecycle (real stores)', () => {
  it('accumulates raw text during streaming, then persists the completed message on done', async () => {
    seedConversation();
    mountListeners();
    await waitForTokenHandler();

    // --- Phase 1: streaming (done:false) -----------------------------------
    emitToken('Hello', false);
    emitToken(', ', false);
    emitToken('world', false);

    // Tokens buffer in the coalescer until the rAF tick; drain synchronously.
    drainPendingTokenBatch();

    // A. Raw text accumulated in the streaming store's live buffer.
    const streamState = useStreamingStore.getState();
    expect(streamState.activeStreams[CONV_ID]).toBe(REQUEST_ID);
    expect(streamState.liveContent[CONV_ID].content).toBe('Hello, world');

    // B. The assistant placeholder in the message store is untouched — no
    // markdown/parse-ready content lands there during streaming
    // (done:false raw-text boundary).
    const midMsgs = useMessageStore.getState().messages[CONV_ID];
    const midAssistant = midMsgs[midMsgs.length - 1];
    expect(midAssistant.content).toBe('');
    expect(midAssistant.done).not.toBe(true);
    expect(mockPersistMessage).not.toHaveBeenCalled();

    // --- Phase 2: completion (done:true) ------------------------------------
    handlerBoxes['ollama-token']!({
      requestId: REQUEST_ID,
      message: { role: 'assistant', content: '!' },
      done: true,
      evalCount: 4,
      promptEvalCount: 7,
    });

    // C. The flush appended the final token + metrics onto the assistant
    // message, which is now flagged done and NOT marked stopped.
    const finalMsgs = useMessageStore.getState().messages[CONV_ID];
    const finalAssistant = finalMsgs[finalMsgs.length - 1];
    expect(finalAssistant.content).toBe('Hello, world!');
    expect(finalAssistant.done).toBe(true);
    expect(finalAssistant.stopped).toBe(false);
    expect(finalAssistant.evalCount).toBe(4);
    expect(finalAssistant.promptEvalCount).toBe(7);
    expect(finalAssistant.totalTokens).toBe(11);

    // D. The completed message was persisted to the backend with full content.
    expect(mockPersistMessage).toHaveBeenCalledWith(
      CONV_ID,
      expect.objectContaining({ id: 'm-asst', content: 'Hello, world!', done: true })
    );

    // E. Stream torn down: no active stream, no live buffer, no global flag.
    const endStream = useStreamingStore.getState();
    expect(endStream.activeStreams[CONV_ID]).toBeUndefined();
    expect(endStream.liveContent[CONV_ID]).toBeUndefined();
    expect(useUIStore.getState().isStreaming).toBe(false);
  });
});

describe('chat-stream abort lifecycle (real stores)', () => {
  it('user abort flushes buffered tokens, marks stopped, and tears down the stream', async () => {
    seedConversation();
    mountListeners();
    await waitForTokenHandler();

    emitToken('partial ', false);
    emitToken('reply', false);
    drainPendingTokenBatch();

    // Sanity: buffered but not yet in the message store.
    const pre = useMessageStore.getState().messages[CONV_ID];
    expect(pre[pre.length - 1].content).toBe('');

    // User clicks Stop → abort path (coordination.stopStream with 'abort').
    const { stopStream } = await import('@/store/coordination');
    stopStream(CONV_ID, 'abort', REQUEST_ID);

    const msgs = useMessageStore.getState().messages[CONV_ID];
    const last = msgs[msgs.length - 1];
    expect(last.content).toBe('partial reply');
    expect(last.stopped).toBe(true);
    expect(last.done).toBe(true);

    const streamState = useStreamingStore.getState();
    expect(streamState.activeStreams[CONV_ID]).toBeUndefined();
    expect(useUIStore.getState().isStreaming).toBe(false);

    // Backend persistence is driven by the done:true token path only; abort
    // persists nothing through the token handler (a backend-specific IPC
    // covers that separately).
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });

  it('ignores tokens with an unknown requestId (no active stream)', async () => {
    seedConversation();
    mountListeners();
    await waitForTokenHandler();

    // A token for a request that never started a stream.
    emitToken('ghost', false, 'req-unknown');
    drainPendingTokenBatch();

    const streamState = useStreamingStore.getState();
    expect(streamState.liveContent[CONV_ID]).toBeUndefined();

    const msgs = useMessageStore.getState().messages[CONV_ID];
    expect(msgs[msgs.length - 1].content).toBe('');
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });
});
