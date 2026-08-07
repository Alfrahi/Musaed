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
 * **Abort race guard (audit bug 2.3)**: When `expectedRequestId` is provided,
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

  // Abort race guard (audit bug 2.3): if the caller read a requestId from
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
 * Stops streaming for a conversation — flushes any remaining content,
 * clears the stream, and updates the UI flag if no other streams are active.
 * Also marks the last assistant message as `stopped: true` so the UI can
 * render the "Stopped by user • Continue" affordance (Prompt 14).
 *
 * **Abort race guard (audit bug 2.3)**: When `expectedRequestId` is provided,
 * the function first checks whether the stream currently registered for
 * `conversationId` still matches that requestId. If a new stream has already
 * replaced the old one, the stop is skipped entirely — the new stream is
 * left untouched. Without this guard, a user-initiated stop on an old stream
 * would clean up a newer stream that happened to reuse the same conversation,
 * causing the new message to be incorrectly marked `stopped: true` and its
 * content to be lost.
 */
export function coordinateStopStream(conversationId: string, expectedRequestId?: string): void {
  // Abort race guard (audit bug 2.3): bail out when the active stream has
  // already been replaced by a newer one, so a user-initiated stop on an old
  // stream does not destroy the content/state of the new stream.
  if (expectedRequestId !== undefined) {
    const activeRequestId = useStreamingStore.getState().activeStreams[conversationId];
    if (activeRequestId !== expectedRequestId) return;
  }

  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);

  // Mark the last assistant message as user-stopped so the UI can render
  // the "Stopped by user • Continue" inline status line.
  useMessageStore.getState().updateLastMessage(conversationId, { stopped: true });

  // Only clear global streaming flag when no streams remain active
  const { activeStreams } = useStreamingStore.getState();
  if (Object.keys(activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }

  traceStoreMutation({
    feature: 'streaming',
    action: 'coordinateStopStream',
    level: 'INFO',
    message: `coordinateStopStream for ${conversationId}`,
    context: {
      conversationId,
      streamsRemaining: Object.keys(activeStreams).length,
    },
    throttleMs: 0,
  });
}

/**
 * Single entry point for stopping a conversation's stream — flushes buffered
 * tokens to the message store and cleans up streaming state. This replaces the
 * three previously scattered stop paths (abortStreaming, stopStreaming,
 * coordinateStopStream) that diverged on whether they sent cmd_ollama_abort_chat.
 *
 * Callers that need to abort the backend stream MUST call chatApi.abort(requestId)
 * BEFORE calling this function. The store layer does not initiate IPC.
 *
 * **Abort race guard (audit bug 2.3)**: Pass the `expectedRequestId` that was
 * read from `activeStreams[conversationId]` before calling `chatApi.abort`.
 * When provided, both `flushAndStop` and `coordinateStopStream` verify the
 * active stream still matches before proceeding. If a new stream has replaced
 * the old one between the caller's read and this call, the stop is a no-op
 * and the new stream is left untouched.
 *
 * Idempotent: safe to call multiple times for the same conversation.
 */
export function stopStreamForConversation(
  conversationId: string,
  expectedRequestId?: string
): void {
  flushAndStop(conversationId, expectedRequestId);
  coordinateStopStream(conversationId, expectedRequestId);
}

/**
 * Natural-completion counterpart to `stopStreamForConversation`. Flushes
 * buffered content + pending metrics (promptEvalCount, evalCount, etc.)
 * to the message store and cleans up streaming state — but does NOT set
 * `stopped: true` on the assistant message, since the stream finished on
 * its own rather than being aborted by the user.
 *
 * Called from `useTauriEvents.handleToken` when `payload.done === true`.
 */
export function completeStreamForConversation(conversationId: string): void {
  flushAndStop(conversationId);
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);
  // Explicitly clear the user-stopped flag on natural completion. Without
  // this, a previously-stopped message in this conversation would retain
  // `stopped: true` and the UI would show "Stopped by user" on a message
  // that completed naturally (audit bug 1.4).
  useMessageStore.getState().updateLastMessage(conversationId, { stopped: false });
  const { activeStreams } = useStreamingStore.getState();
  if (Object.keys(activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }
}

/**
 * Stops batching for a conversation without flushing.
 * Used when aborting a stream where buffered content should be discarded.
 * Clears the liveContent and pendingMetrics buffers to prevent memory leaks.
 */
export function stopBatching(conversationId: string): void {
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);
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
