'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { Message } from '@musaed/contracts';

/** Metrics snapshot carried alongside the live token buffer. */
export interface StreamMetrics {
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
}

export interface StreamingState {
  /** Per-conversation live content buffer (only for actively streaming conversations). */
  liveContent: Record<string, string>;
  /** Per-conversation metrics snapshot updated with each token. */
  liveMetrics: Record<string, StreamMetrics>;
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
    liveMetrics: {},
    pendingMetrics: {},
    activeStreams: {},

    appendToken: (conversationId, token) => {
      set((state) => ({
        liveContent: {
          ...state.liveContent,
          [conversationId]: (state.liveContent[conversationId] ?? '') + token,
        },
      }));
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
      const content = liveContent[conversationId];
      if (!content) return null;
      const metrics = pendingMetrics[conversationId] ?? {};

      // Clear flushed content but keep metrics for next flush
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

    clearAll: () =>
      set({ liveContent: {}, liveMetrics: {}, pendingMetrics: {}, activeStreams: {} }),
  }),
  shallow
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectLiveContent = (conversationId: string) => (state: StreamingState) =>
  state.liveContent[conversationId] ?? null;

export const selectIsLiveStreaming = (conversationId: string) => (state: StreamingState) =>
  conversationId in state.activeStreams;

export const selectActiveRequestId = (conversationId: string) => (state: StreamingState) =>
  state.activeStreams[conversationId] ?? null;
