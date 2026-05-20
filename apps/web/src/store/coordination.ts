'use client';

import { useStreamingStore } from './stores/streaming-store';
import { useUIStore } from './stores/ui-store';

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
 * Stops streaming for a conversation — flushes any remaining content,
 * clears the stream, and updates the UI flag if no other streams are active.
 */
export function coordinateStopStream(conversationId: string): void {
  useStreamingStore.getState().stopStream(conversationId);
  useStreamingStore.getState().clearStream(conversationId);

  // Only clear global streaming flag when no streams remain active
  const { activeStreams } = useStreamingStore.getState();
  if (Object.keys(activeStreams).length === 0) {
    useUIStore.getState().setStreaming(false);
  }
}

/**
 * Registers hydration coordination for the app.
 *
 * This is called once on mount in HomeClient. It ensures the UI
 * transitions from the loading state to the interactive state once
 * all stores have hydrated from the Rust backend.
 *
 * Returns an unsubscribe function for cleanup.
 */
export function registerHydrationCoordination(): () => void {
  let disposed = false;

  // Mark as hydrated immediately since persistence is now handled
  // by the Rust backend (no async Tauri Store hydration needed
  // for conversation/message stores).
  const { isHydrated } = useUIStore.getState();
  if (!isHydrated) {
    useUIStore.getState().setHydrated(true);
  }

  return () => {
    if (disposed) return;
    disposed = true;
  };
}
