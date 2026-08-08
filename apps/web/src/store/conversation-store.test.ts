import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

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

// Round-trip legacy persisted shapes through the v2 migration introduced for
// the structured `Message.error` field (STANDARDS §9).
// The conversation store persists `ConversationMetadata` only — messages live
// in Rust SQLite — so the migration is a defensive identity pass-through that
// must not invent or drop fields.
describe('Conversation Store migrations', () => {
  let MIGRATIONS: any;
  let VERSION: number;
  beforeAll(async () => {
    const mod = await import('./conversation-store');
    MIGRATIONS = mod.__test_CONVERSATION_MIGRATIONS;
    VERSION = mod.__test_CONVERSATION_STORE_VERSION;
  });

  it('exposes the current store schema version', () => {
    expect(VERSION).toBe(3);
    expect(typeof MIGRATIONS[VERSION]).toBe('function');
  });

  it('round-trips a v1 persisted shape through the v3 migration unchanged', () => {
    const legacy = {
      conversations: { c1: { id: 'c1', title: 'Old', model: 'llama2' } },
      conversationIds: ['c1'],
      currentConversationId: 'c1',
      searchQuery: '',
    };

    // v1 → v3: messages were never persisted here, so the migration must not
    // invent or drop fields. Old-shape `ConversationMetadata` round-trips
    // with `error` and `stopped` left undefined (handled on the Rust side per STANDARDS §10).
    const fromV1 = MIGRATIONS[1](legacy) as typeof legacy;
    const fromV2 = MIGRATIONS[2](legacy) as typeof legacy;
    const fromV3 = MIGRATIONS[3](legacy) as typeof legacy;

    expect(fromV1).toEqual(legacy);
    expect(fromV2).toEqual(legacy);
    expect(fromV3).toEqual(legacy);
    expect('error' in fromV3.conversations.c1).toBe(false);
  });

  it('coerces a malformed persisted value back to the default state shape', () => {
    const migrated = MIGRATIONS[3](null) as {
      conversations: unknown;
      conversationIds: unknown;
      currentConversationId: unknown;
      searchQuery: unknown;
    };

    expect(migrated.conversations).toEqual({});
    expect(migrated.conversationIds).toEqual([]);
    expect(migrated.currentConversationId).toBeNull();
    expect(migrated.searchQuery).toBe('');
  });
});
