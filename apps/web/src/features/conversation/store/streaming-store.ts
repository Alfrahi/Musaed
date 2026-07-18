'use client';

import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StoreApi, UseBoundStore } from 'zustand';
import { type Message } from '@musaed/contracts';
import { createTauriStorage } from '@/lib/tauri-storage';

// Default state for streaming store
const DEFAULT_STREAMING_STATE = {
  liveContent: {},
  pendingMetrics: {},
  activeStreams: {},
  flushedStreams: new Set(),
};

// Migrations for streaming store
const STREAMING_MIGRATIONS: Record<number, (data: unknown) => unknown> = {
  1: (data: unknown) => {
    const persisted =
      typeof data === 'object' && data !== null ? (data as Partial<StreamingState>) : {};
    return { ...DEFAULT_STREAMING_STATE, ...persisted };
  },
};

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
  /** Track which conversations have been flushed to prevent duplicate flushes. */
  flushedStreams: Set<string>;

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

// Store instance with a custom getState overload that accepts an optional
// selector — used by the test suite. We preserve the full zustand store API
// (call signature, setState, subscribe) and only widen the getState signature.
type StreamingStoreBase = UseBoundStore<StoreApi<StreamingState>>;
export type StreamingStore = StreamingStoreBase & {
  getState: {
    (): StreamingState;
    <T>(selector: (state: StreamingState) => T): T;
  };
};

const _useStreamingStore = createWithEqualityFn<StreamingState>()(
  persist(
    (set, get) => ({
      liveContent: {},
      pendingMetrics: {},
      activeStreams: {},
      flushedStreams: new Set(),

      appendToken: (conversationId, token) => {
        set((state) => {
          // Only append tokens for conversations that are actively streaming
          // This prevents zombie buffer creation after clearStream is called
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

      flushToConversation: (conversationId) => {
        const { liveContent, pendingMetrics, flushedStreams } = get();

        // Prevent duplicate flushes (idempotency guard)
        if (flushedStreams.has(conversationId)) {
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

        return { content, metrics };
      },

      markFlushed: (conversationId) => {
        set((state) => ({
          flushedStreams: new Set(state.flushedStreams).add(conversationId),
        }));
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

      clearAll: () =>
        set({ liveContent: {}, pendingMetrics: {}, activeStreams: {}, flushedStreams: new Set() }),
    }),
    {
      name: 'musaed-streaming-storage',
      storage: createJSONStorage(() =>
        createTauriStorage('streaming-state.json', 1, STREAMING_MIGRATIONS)
      ),
      version: 1,
      migrate: (persistedState, version) => {
        const migration = STREAMING_MIGRATIONS[version];
        if (migration && typeof persistedState === 'object' && persistedState !== null) {
          return migration(persistedState);
        }
        return { ...DEFAULT_STREAMING_STATE, ...(persistedState as Partial<StreamingState>) };
      },
      skipHydration: true,
    }
  ),
  shallow
);

// Enhance getState to accept a selector function (as used in the test suite).
// The default Zustand getState only returns the full state; we add an optional
// selector overload for convenient one-shot reads.
const _rawGetState = _useStreamingStore.getState;
const getStateWithSelector = ((selector?: (state: StreamingState) => unknown) => {
  const state = _rawGetState();
  return typeof selector === 'function' ? selector(state) : state;
}) as StreamingStore['getState'];

export const useStreamingStore = _useStreamingStore as unknown as StreamingStore;
useStreamingStore.getState = getStateWithSelector;

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
