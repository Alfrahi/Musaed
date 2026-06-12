'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { type Message } from '@musaed/contracts';

/** Internal buffer for efficient stream accumulation. */
interface StreamingBuffer {
  chunks: string[];
}

export interface StreamingState {
  /** Per-conversation live content buffer (only for actively streaming conversations). */
  liveContent: Record<string, StreamingBuffer>;
  /** Pending metrics that haven't been flushed yet. */
  pendingMetrics: Record<string, Partial<Message>>;
  /** Track which conversations are actively streaming. */
  activeStreams: Record<string, string>;

  appendToken: (conversationId: string, token: string) => void;
  setPendingMetrics: (conversationId: string, metrics: Partial<Message>) => void;
  flushToConversation: (
    conversationId: string
  ) => { content: string; metrics: Partial<Message> } | null;
  startStream: (conversationId: string, requestId: string) => void;
  stopStream: (conversationId: string) => void;
  clearStream: (conversationId: string) => void;
  clearAll: () => void;
}

export const useStreamingStore = createWithEqualityFn<StreamingState>()(
  (set, get) => ({
    liveContent: {},
    pendingMetrics: {},
    activeStreams: {},

    appendToken: (conversationId, token) => {
      set((state) => {
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

    flushToConversation: (conversationId) => {
      const { liveContent, pendingMetrics } = get();
      const buffer = liveContent[conversationId];
      if (!buffer) return null;
      const content = buffer.chunks.join('');
      const metrics = pendingMetrics[conversationId] ?? {};

      // Clear flushed content and metrics
      set((state) => {
        const { [conversationId]: _flushed, ...remaining } = state.liveContent;
        const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
        return { liveContent: remaining, pendingMetrics: remainingMetrics };
      });

      return { content, metrics };
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
      set((state) => {
        const { [conversationId]: _content, ...remainingContent } = state.liveContent;
        const { [conversationId]: _metrics, ...remainingMetrics } = state.pendingMetrics;
        const { [conversationId]: _stream, ...remainingStreams } = state.activeStreams;
        return {
          liveContent: remainingContent,
          pendingMetrics: remainingMetrics,
          activeStreams: remainingStreams,
        };
      });
    },

    clearAll: () => set({ liveContent: {}, pendingMetrics: {}, activeStreams: {} }),
  }),
  shallow
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectLiveContent = (conversationId: string) => (state: StreamingState) =>
  state.liveContent[conversationId]?.chunks.join('') ?? null;

export const selectIsLiveStreaming = (conversationId: string) => (state: StreamingState) =>
  conversationId in state.activeStreams;

export const selectActiveRequestId = (conversationId: string) => (state: StreamingState) =>
  state.activeStreams[conversationId] ?? null;
