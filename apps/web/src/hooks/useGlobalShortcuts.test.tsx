import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { clearMocks } from '@tauri-apps/api/mocks';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useUIStore } from '@/store/ui-store';
import { useConversationStore } from '@/store/conversation-store';
import { useStreamingStore } from '@/store/streaming-store';

// Mutable mock container: useConversationActions() returns this object so each
// test can drive createNewConversation independently without re-mocking. The
// container itself is captured by the hoisted vi.mock factory; spy methods are
// read at call-time as properties so the factory never sees an uninitialized
// binding (vitest hoists vi.mock above every top-level statement).
const mockActions = {
  createNewConversation: vi.fn(),
  deleteConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  clearAllConversations: vi.fn(),
  initiateStreaming: vi.fn(),
  stopStreaming: vi.fn(),
};

// abortStreaming is a barrel re-export from @/features/conversation. Mock it as
// a spy so the Escape-to-stop contract can be asserted on call count, not on
// the streaming store's internal side effects (which would couple the test to
// flushAndStop / coordinateStopStream internals). Wrapped in a container for
// the same hoisting reason as mockActions.
const abortMock = { abortStreaming: vi.fn() };

vi.mock('@/features/conversation', async () => {
  const actual = await vi.importActual('@/features/conversation');
  return {
    ...(actual as object),
    useConversationActions: () => mockActions,
    abortStreaming: (...args: unknown[]) => abortMock.abortStreaming(...args),
  };
});

// Test harness: a tiny component that mounts the hook. The hook subscribes to
// a window keydown listener; rendering it inside a component lets us exercise
// the listener in a realistic React lifecycle.
const Harness = () => {
  useGlobalShortcuts();
  return null;
};

const dispatchEscape = () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
};

describe('useGlobalShortcuts', () => {
  beforeEach(() => {
    clearMocks();
    mockActions.createNewConversation.mockClear();
    abortMock.abortStreaming.mockClear();

    // Default: no modal open, an active conversation, not streaming.
    useUIStore.setState({
      isHydrated: true,
      isStreaming: false,
      isInitialized: false,
      isOllamaConnected: false,
      errorMessage: null,
      isSettingsOpen: false,
      isLibraryOpen: false,
      isInfoOpen: false,
      _pendingRehydrations: 0,
    });
    useConversationStore.setState({
      conversations: {},
      conversationIds: [],
      currentConversationId: 'conv-active',
      searchQuery: '',
    });
    useStreamingStore.setState({
      liveContent: {},
      pendingMetrics: {},
      activeStreams: {},
      flushedStreams: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Escape-to-stop contract (audit F6)', () => {
    it('(a) Escape while streaming and no modal open → abortStreaming called once', () => {
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(abortMock.abortStreaming).toHaveBeenCalledTimes(1);
      expect(abortMock.abortStreaming).toHaveBeenCalledWith('conv-active');
    });

    it('(b) Escape while streaming and modal open → modal closes, abortStreaming not called', () => {
      useUIStore.setState({ isSettingsOpen: true });
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(abortMock.abortStreaming).not.toHaveBeenCalled();
      // Modals were closed (idempotent setters; verify the end-state of the ui store)
      expect(useUIStore.getState().isSettingsOpen).toBe(false);
      expect(useUIStore.getState().isLibraryOpen).toBe(false);
      expect(useUIStore.getState().isInfoOpen).toBe(false);
    });

    it('(c) Escape while not streaming → no-op (abortStreaming not called, modals untouched)', () => {
      // No active stream, no modal — Escape should be a complete no-op.
      render(<Harness />);
      dispatchEscape();

      expect(abortMock.abortStreaming).not.toHaveBeenCalled();
    });
  });

  describe('Escape routing edge cases', () => {
    it(' Escape with no active conversation → abortStreaming not called even if activeStreams has stale entries', () => {
      useConversationStore.setState({ currentConversationId: null });
      // Stale entry in activeStreams that does NOT match any current conversation
      useStreamingStore.setState({
        activeStreams: { 'stale-conv': 'req-2' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(abortMock.abortStreaming).not.toHaveBeenCalled();
    });

    it(' Escape with Info modal open → closes Info and does not stop streaming', () => {
      useUIStore.setState({ isInfoOpen: true });
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(abortMock.abortStreaming).not.toHaveBeenCalled();
      expect(useUIStore.getState().isInfoOpen).toBe(false);
      expect(useUIStore.getState().isSettingsOpen).toBe(false);
      expect(useUIStore.getState().isLibraryOpen).toBe(false);
    });
  });
});
