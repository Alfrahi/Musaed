import { describe, it, expect, beforeEach } from 'vitest';

// Mock Tauri environment
beforeEach(() => {
  (window as any).__TAURI_INTERNALS__ = {};
});

describe('Conversation Store Exports', () => {
  it('should export all required hooks and selectors from conversation store', async () => {
    const store = await import('./index');

    expect(store.useConversationStore).toBeDefined();
    expect(store.useUpdateConversation).toBeDefined();
    expect(store.useBatchUpdate).toBeDefined();
    expect(store.selectCurrentConversation).toBeDefined();
    expect(store.selectFilteredConversations).toBeDefined();
  });

  it('should export message store hooks', async () => {
    const store = await import('./index');

    expect(store.useMessageStore).toBeDefined();
    expect(store.selectMessages).toBeDefined();
  });

  it('should export streaming store hooks and selectors', async () => {
    const store = await import('./index');

    expect(store.useStreamingStore).toBeDefined();
    expect(store.selectLiveContent).toBeDefined();
    expect(store.selectIsLiveStreaming).toBeDefined();
    expect(store.selectActiveRequestId).toBeDefined();
  });
});
