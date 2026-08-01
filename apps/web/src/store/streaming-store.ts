'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { type Message } from '@musaed/contracts';
import { traceStoreMutation, traceAppendToken, resetTokenCounter } from '@/lib/store-tracing';

/** Internal buffer for efficient stream accumulation. */
interface StreamingBuffer {
  chunks: string[];
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
  const { liveContent, pendingMetrics, flushedStreams } = get();

  // Prevent duplicate flushes (idempotency guard)
  if (flushedStreams.includes(conversationId)) {
    return null;
  }

  const buffer = liveContent[conversationId];
  // If no buffer, but may have pending metrics, return null as before
  if (!buffer) {
    // No content and no buffer -> return null
    if (!pendingMetrics[conversationId]) return null;
    // No buffer but metrics exist -> treat as empty content
    const metrics = pendingMetrics[conversationId] ?? {};
    // Clear metrics since flushed
    set((state) => {
      const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
      return { pendingMetrics: remainingMetrics };
    });
    return { content: '', metrics };
  }
  const content = buffer.chunks.join('');
  const metrics = pendingMetrics[conversationId] ?? {};

  // Clear flushed content and metrics
  set((state) => {
    const { [conversationId]: _flushed, ...remaining } = state.liveContent;
    const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
    return { liveContent: remaining, pendingMetrics: remainingMetrics };
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

export interface StreamingState {
  /** Per-conversation live content buffer (only for actively streaming conversations). */
  liveContent: Record<string, StreamingBuffer>;
  /** Pending metrics that haven't been flushed yet. */
  pendingMetrics: Record<string, Partial<Message>>;
  /** Track which conversations are actively streaming. */
  activeStreams: Record<string, string>;
  /** Track which conversations have been flushed to prevent duplicate flushes. */
  flushedStreams: string[];

  appendToken: (conversationId: string, token: string) => void;
  setPendingMetrics: (conversationId: string, metrics: Partial<Message>) => void;
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
    flushedStreams: [] as string[],

    appendToken: (conversationId, token) => {
      const currentChunks = get().liveContent[conversationId]?.chunks.length ?? 0;
      traceAppendToken(conversationId, currentChunks);
      set((state) => {
        if (!(conversationId in state.activeStreams)) {
          return state;
        }

        const buffer = state.liveContent[conversationId] ?? { chunks: [] };
        return {
          liveContent: {
            ...state.liveContent,
            [conversationId]: {
              chunks: [...buffer.chunks, token],
            },
          },
        };
      });
    },

    setPendingMetrics: (conversationId, metrics) => {
      set((state) => ({
        pendingMetrics: {
          ...state.pendingMetrics,
          [conversationId]: { ...state.pendingMetrics[conversationId], ...metrics },
        },
      }));
    },

    flushToConversation: (conversationId) => runFlushToConversation(conversationId, get, set),

    markFlushed: (conversationId) => {
      set((state) => {
        if (state.flushedStreams.includes(conversationId)) {
          return state;
        }
        return {
          flushedStreams: [...state.flushedStreams, conversationId],
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
        const remainingFlushed = state.flushedStreams.filter((id) => id !== conversationId);
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
        flushedStreams: [] as string[],
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
  state.liveContent[conversationId]?.chunks.join('') ?? null;

export const selectIsLiveStreaming = (conversationId: string) => (state: StreamingState) =>
  conversationId in state.activeStreams;

export const selectActiveRequestId = (conversationId: string) => (state: StreamingState) =>
  state.activeStreams[conversationId] ?? null;
