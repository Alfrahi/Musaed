'use client';

import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useRagStore } from '@/store/rag-store';
import { useModelStore } from '@/store/model-store';
import { useModelParamsStore } from '@/store/model-params-store';
// import { useConversationStore } from '@/store/conversation-store'; // persistence moved to Rust
import { useStreamingStore } from '@/store/streaming-store';
import { useMessageStore } from '@/store/message-store';
import { traceStoreMutation } from '@/lib/store-tracing';
// `ConversationMetadata` is defined in conversation-store.ts and re-exported from
// the store barrel; coordination.ts historically also exported it. We re-export
// (not redefine) to keep a single canonical declaration and avoid TS2308
// "already exported a member named 'ConversationMetadata'" collisions.
export type { ConversationMetadata } from './conversation-store';

/**
 * Coordinates streaming start/stop between the streaming store
 * and UI state (isStreaming flag).
 *
 * This replaces the previous coordination module that also handled
 * persistence batching. Now that persistence is handled by the Rust
 * backend, coordination only manages the streaming lifecycle.
 */

/** Reason a stream is being stopped. Determines flush/marker behavior. */
export type StopReason = 'complete' | 'abort' | 'error' | 'batch-end';

/**
 * Starts streaming for a conversation — marks the UI as streaming
 * and registers the stream in the streaming store.
 */
export function coordinateStartStream(conversationId: string, requestId: string): void {
  useUIStore.getState().setStreaming(true);
  useStreamingStore.getState().startStream(conversationId, requestId);
}

/**
 * Flushes any pending content from the streaming buffer to the message store,
 * then removes the conversation from active streams.
 *
 * This ensures buffered tokens are persisted before abort/stop so no content
 * is silently discarded.
 *
 * **Abort race guard**: When `expectedRequestId` is provided,
 * the function first checks whether the stream currently registered for
 * `conversationId` still matches that requestId. If a new stream has already
 * replaced the old one (e.g. the user sent a new message between the caller
 * reading `activeStreams[conversationId]` and calling this function), the flush
 * is skipped entirely — the new stream is left untouched and its buffered
 * tokens are not stolen. Without this guard, a user-initiated stop on an old
 * stream would destroy the content of a newer stream that happened to reuse
 * the same conversation.
 *
 * Idempotent: calling multiple times for the same conversationId is safe.
 */
export function flushAndStop(conversationId: string, expectedRequestId?: string): void {
  const streamingStore = useStreamingStore.getState();

  // Abort race guard: if the caller read a requestId from
  // `activeStreams[conversationId]` before calling this function, bail out
  // when the active stream has already been replaced by a newer one. This
  // prevents flush-to-completion from stealing the new stream's buffered
  // tokens when the old stream was aborted.
  if (expectedRequestId !== undefined) {
    const activeRequestId = streamingStore.activeStreams[conversationId];
    if (activeRequestId !== expectedRequestId) return;
  }

  const result = streamingStore.flushToConversation(conversationId);

  if (result) {
    // Use atomic update to avoid stale closure race condition
    // where messages added during flush would be lost
    useMessageStore.getState().updateLastMessage(conversationId, {
      content: result.content,
      ...result.metrics,
      done: true,
    });

    // Mark as flushed to prevent duplicate flushes (race condition guard)
    streamingStore.markFlushed(conversationId);

    traceStoreMutation({
      feature: 'streaming',
      action: 'flushAndStop',
      level: 'INFO',
      message: `flushAndStop for ${conversationId}`,
      context: {
        conversationId,
        contentLen: result.content.length,
        metricKeys: Object.keys(result.metrics),
      },
      throttleMs: 0,
    });
  }
}

/**
 * The single entry point for stopping a conversation's stream.
 *
 * Consolidates the previously scattered stop paths (`stopStreamForConversation`,
 * `completeStreamForConversation`, and two inline bypasses in feature hooks)
 * that diverged on whether they flushed buffered tokens, set the `stopped`
 * marker on the assistant message, and cleared the global `isStreaming` flag.
 * Each {@link StopReason reason} pins down those three decisions so the
 * behavior is uniform and discoverable:
 *
 * | reason       | flushes | `stopped` on last msg | clears `isStreaming` |
 * | ------------ | :----: | :---------------------: | :------------------: |
 * | `'complete'` |   ✓    |       `false`           |         ✓            |
 * | `'abort'`    |   ✓    |       `true`            |         ✓            |
 * | `'error'`    |   ✓    |       (untouched)       |         ✓            |
 * | `'batch-end'`|   ✗    |       (untouched)       |         ✓            |
 *
 * **Flush + race guard**: For `'complete'`, `'abort'`, and `'error'`, the
 * function first calls {@link flushAndStop} so buffered tokens are persisted
 * to the message store before the stream is torn down. When
 * `expectedRequestId` is provided, both the flush and the cleanup bail out
 * if the active stream for `conversationId` no longer matches — a newer
 * stream has replaced it in the gap between the caller reading
 * `activeStreams[conversationId]` and this call. The new stream is left
 * untouched. `'batch-end'` skips the flush entirely (buffered content is
 * deliberately discarded — used by the orphan-cleanup path when a stream
 * failed before any tokens were emitted).
 *
 * **`isStreaming` invariant**: The global `isStreaming` flag is cleared if
 * and only if no active streams remain after this conversation is removed.
 * This keeps the flag truthful when multiple conversations stream concurrently.
 *
 * **Backend abort**: Callers that need to abort the backend stream MUST call
 * `chatApi.abort(requestId)` BEFORE calling this function. The store layer
 * does not initiate IPC.
 *
 * Idempotent: safe to call multiple times for the same conversation.
 */
export function stopStream(
  conversationId: string,
  reason: StopReason,
  expectedRequestId?: string
): void {
  // Abort race guard: bail out before doing any work if the caller thought it
  // was stopping one stream but a newer stream has already replaced it. This
  // prevents the new stream's buffered content from being flushed onto the
  // previous (now-stale) assistant message and the new message from being
  // incorrectly marked `stopped`.
  if (expectedRequestId !== undefined) {
    const activeRequestId = useStreamingStore.getState().activeStreams[conversationId];
    if (activeRequestId !== expectedRequestId) return;
  }

  const shouldFlush = reason !== 'batch-end';
  if (shouldFlush) {
    flushAndStop(conversationId, expectedRequestId);
  }

  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);

  // Reason-specific assistant-message marker. Only `complete` and `abort`
  // touch `stopped`; `error` and `batch-end` leave whatever the caller
  // already set in place.
  if (reason === 'abort') {
    // Mark the last assistant message as user-stopped so the UI can render
    // the "Stopped by user • Continue" inline status line.
    useMessageStore.getState().updateLastMessage(conversationId, { stopped: true });
  } else if (reason === 'complete') {
    // Explicitly clear the user-stopped flag on natural completion. Without
    // this, a previously-stopped message in this conversation would retain
    // `stopped: true` and the UI would show "Stopped by user" on a message
    // that completed naturally.
    useMessageStore.getState().updateLastMessage(conversationId, { stopped: false });
  }

  // Only clear the global streaming flag when no streams remain active.
  const { activeStreams } = useStreamingStore.getState();
  if (Object.keys(activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }

  traceStoreMutation({
    feature: 'streaming',
    action: 'stopStream',
    level: 'INFO',
    message: `stopStream(${reason}) for ${conversationId}`,
    context: {
      conversationId,
      reason,
      streamsRemaining: Object.keys(activeStreams).length,
    },
    throttleMs: 0,
  });
}

type PersistedStore = {
  persist: { rehydrate: () => Promise<unknown> | unknown };
};

const PERSISTED_STORES: ReadonlyArray<PersistedStore> = [
  useSettingsStore,
  useRagStore,
  useModelStore,
  useModelParamsStore,
];

const STORES_TO_HYDRATE = PERSISTED_STORES.length;

/**
 * Triggers async rehydration for all persisted stores that use skipHydration.
 * Each store's onRehydrateStorage callback will call UIStore.onStoreRehydrated(),
 * which decrements the pending counter. When it reaches 0, isHydrated is set true.
 */
export function registerHydrationCoordination(): () => void {
  let disposed = false;

  const { isHydrated } = useUIStore.getState();

  if (!isHydrated) {
    useUIStore.getState().setPendingRehydrations(STORES_TO_HYDRATE);
    for (const store of PERSISTED_STORES) {
      store.persist.rehydrate();
    }
  }

  return () => {
    if (disposed) return;
    disposed = true;
  };
}
