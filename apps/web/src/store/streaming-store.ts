'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { type Message } from '@musaed/contracts';
import { traceStoreMutation, traceAppendToken, resetTokenCounter } from '@/lib/store-tracing';

/** Internal buffer for efficient stream accumulation. */
interface StreamingBuffer {
  content: string;
}

/**
 * Body of `flushToConversation`, lifted out of the store-creator arrow so
 * the creator stays under the project's per-function line limit. Reads the
 * buffer, clears the flushed entries, and emits a §14 store-mutation trace.
 */
function runFlushToConversation(
  conversationId: string,
  get: () => StreamingState,
  set: (
    partial: Partial<StreamingState> | ((state: StreamingState) => Partial<StreamingState>)
  ) => void
): { content: string; metrics: Partial<Message> } | null {
  const { liveContent, pendingMetrics } = get();
  const buffer = liveContent[conversationId];
  // If no buffer, but may have pending metrics, return metrics as before
  if (!buffer) {
    if (!pendingMetrics[conversationId]) return null;
    const metrics = pendingMetrics[conversationId] ?? {};
    set((state) => {
      const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
      return {
        pendingMetrics: remainingMetrics,
        flushedStreams: new Set([...state.flushedStreams, conversationId]),
      };
    });
    return { content: '', metrics };
  }

  const content = buffer.content;
  const metrics = pendingMetrics[conversationId] ?? {};

  // Clear flushed content and metrics, and mark as flushed atomically.
  // We intentionally do NOT early-return when the conversation is already
  // in `flushedStreams`. A prior flush may have happened (e.g. user clicked
  // stop), then more tokens arrived via `appendToken` before `clearStream`
  // ran. Those late tokens are still in `liveContent` and must be flushed,
  // otherwise they are permanently lost. Returning `{ content, metrics }`
  // here lets the caller (flushAndStop → updateLastMessage) append them.
  set((state) => {
    const { [conversationId]: _flushed, ...remaining } = state.liveContent;
    const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
    return {
      liveContent: remaining,
      pendingMetrics: remainingMetrics,
      flushedStreams: new Set([...state.flushedStreams, conversationId]),
    };
  });

  resetTokenCounter(conversationId);
  traceStoreMutation({
    feature: 'streaming',
    action: 'flushToConversation',
    level: 'DEBUG',
    message: `flushToConversation for ${conversationId}`,
    context: {
      conversationId,
      contentLen: content.length,
      metricKeys: Object.keys(metrics),
    },
    throttleMs: 0,
  });

  return { content, metrics };
}

/**
 * Body of `setPendingMetrics`, lifted out of the store-creator arrow so the
 * creator stays under the project's per-function line limit.
 */
function runSetPendingMetrics(
  state: StreamingState,
  conversationId: string,
  requestId: string,
  metrics: Partial<Message>
): StreamingState | Partial<StreamingState> {
  // Defense-in-depth gate mirroring appendToken: metrics tagged with a
  // requestId that no longer owns this conversation's stream belong to
  // a dead retry and must not land on the active one.
  if (state.activeStreams[conversationId] !== requestId) {
    return state;
  }

  return {
    pendingMetrics: {
      ...state.pendingMetrics,
      [conversationId]: { ...state.pendingMetrics[conversationId], ...metrics },
    },
  };
}

export interface StreamingState {
  /** Per-conversation live content buffer (only for actively streaming conversations). */
  liveContent: Record<string, StreamingBuffer>;
  /** Pending metrics that haven't been flushed yet. */
  pendingMetrics: Record<string, Partial<Message>>;
  /** Track which conversations are actively streaming. */
  activeStreams: Record<string, string>;
  /** Track which conversations have been flushed to prevent duplicate flushes. */
  flushedStreams: Set<string>;

  appendToken: (conversationId: string, token: string, requestId: string) => void;
  appendTokenBulk: (conversationId: string, text: string, requestId: string) => void;
  setPendingMetrics: (conversationId: string, requestId: string, metrics: Partial<Message>) => void;
  flushToConversation: (
    conversationId: string
  ) => { content: string; metrics: Partial<Message> } | null;
  startStream: (conversationId: string, requestId: string) => void;
  stopStream: (conversationId: string) => void;
  clearStream: (conversationId: string) => void;
  markFlushed: (conversationId: string) => void;
  clearAll: () => void;
}

const _useStreamingStore = createWithEqualityFn<StreamingState>()(
  (set, get) => ({
    liveContent: {},
    pendingMetrics: {},
    activeStreams: {},
    flushedStreams: new Set<string>(),

    appendToken: (conversationId, token, requestId) => {
      const currentLen = get().liveContent[conversationId]?.content.length ?? 0;
      traceAppendToken(conversationId, currentLen);
      set((state) => {
        // Gate on the requestId to prevent tokens from a stale stream
        // being appended to a newer stream (or after stop). If the
        // registered requestId for this conversation does not match the
        // one the caller provided, the token belongs to an old stream
        // and must be dropped.
        if (state.activeStreams[conversationId] !== requestId) {
          return state;
        }

        const buffer = state.liveContent[conversationId] ?? { content: '' };
        return {
          liveContent: {
            ...state.liveContent,
            [conversationId]: {
              content: buffer.content + token,
            },
          },
        };
      });
    },

    appendTokenBulk: (conversationId, text, requestId) => {
      set((state) => {
        if (state.activeStreams[conversationId] !== requestId) {
          return state;
        }

        const buffer = state.liveContent[conversationId] ?? { content: '' };
        return {
          liveContent: {
            ...state.liveContent,
            [conversationId]: {
              content: buffer.content + text,
            },
          },
        };
      });
    },

    setPendingMetrics: (conversationId, requestId, metrics) => {
      set((state) => runSetPendingMetrics(state, conversationId, requestId, metrics));
    },

    flushToConversation: (conversationId) => runFlushToConversation(conversationId, get, set),

    markFlushed: (conversationId) => {
      set((state) => {
        if (state.flushedStreams.has(conversationId)) {
          return state;
        }
        return {
          flushedStreams: new Set([...state.flushedStreams, conversationId]),
        };
      });
    },

    startStream: (conversationId, requestId) => {
      set((state) => ({
        activeStreams: { ...state.activeStreams, [conversationId]: String(requestId) },
      }));
    },

    stopStream: (conversationId) => {
      set((state) => {
        const { [conversationId]: _stream, ...remainingStreams } = state.activeStreams;
        return { activeStreams: remainingStreams };
      });
    },

    clearStream: (conversationId) => {
      resetTokenCounter(conversationId);
      set((state) => {
        const { [conversationId]: _content, ...remainingContent } = state.liveContent;
        const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
        const { [conversationId]: _stream, ...remainingStreams } = state.activeStreams;
        const remainingFlushed = new Set(state.flushedStreams);
        remainingFlushed.delete(conversationId);
        return {
          liveContent: remainingContent,
          pendingMetrics: remainingMetrics,
          activeStreams: remainingStreams,
          flushedStreams: remainingFlushed,
        };
      });
    },

    clearAll: () => {
      for (const id of Object.keys(get().liveContent)) {
        resetTokenCounter(id);
      }
      set({
        liveContent: {},
        pendingMetrics: {},
        activeStreams: {},
        flushedStreams: new Set<string>(),
      });
    },
  }),
  shallow
);

export const useStreamingStore = _useStreamingStore;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

// Selectors – accept Zustand state as argument
export const selectLiveContent = (conversationId: string) => (state: StreamingState) =>
  state.liveContent[conversationId]?.content ?? null;

export const selectIsLiveStreaming = (conversationId: string) => (state: StreamingState) =>
  conversationId in state.activeStreams;

export const selectActiveRequestId = (conversationId: string) => (state: StreamingState) =>
  state.activeStreams[conversationId] ?? null;
