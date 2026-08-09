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
  stopStream: vi.fn(),
};

// stopStream is imported from @/store/coordination. Mock it as
// a spy so the Escape-to-stop contract can be asserted on call count, not on
// the streaming store's internal side effects (which would couple the test to
// flushAndStop internals). Wrapped in a container for
// the same hoisting reason as mockActions.
const coordinationMock = { stopStream: vi.fn() };

vi.mock('@/features/conversation', async () => {
  const actual = await vi.importActual('@/features/conversation');
  return {
    ...(actual as object),
    useConversationActions: () => mockActions,
  };
});

vi.mock('@/store/coordination', () => ({
  stopStream: (...args: unknown[]) => coordinationMock.stopStream(...args),
}));

// Mock settings store for the Cmd+B sidebar toggle handler.
const settingsState = {
  globalSettings: {
    sidebarCollapsed: false,
    language: 'en',
  },
  setGlobalSettings: vi.fn((next: typeof settingsState) => {
    settingsState.globalSettings = next.globalSettings ?? next;
  }),
};
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: typeof settingsState) => unknown) => {
      if (typeof selector === 'function') return selector(settingsState);
      return settingsState;
    },
    { getState: () => settingsState }
  ),
}));

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
    coordinationMock.stopStream.mockClear();
    settingsState.setGlobalSettings.mockClear?.();

    // Default: no modal open, an active conversation, not streaming.
    useUIStore.setState({
      isHydrated: true,
      isStreaming: false,
      isInitialized: false,
      isOllamaConnected: false,
      errorMessage: null,
      activeModal: null,
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
      flushedStreams: new Set<string>(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Escape-to-stop contract', () => {
    it('(a) Escape while streaming and no modal open → stopStream called once', () => {
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(coordinationMock.stopStream).toHaveBeenCalledTimes(1);
      // The requestId is passed so the abort race guard can bail out if the
      // stream has been replaced before the stop runs.
      expect(coordinationMock.stopStream).toHaveBeenCalledWith('conv-active', 'abort', 'req-1');
    });

    it('(b) Escape while streaming and modal open → modal closes, stopStream not called', () => {
      useUIStore.setState({ activeModal: 'settings' });
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(coordinationMock.stopStream).not.toHaveBeenCalled();
      // Modal was closed
      expect(useUIStore.getState().activeModal).toBe(null);
    });

    it('(c) Escape while not streaming → no-op (stopStream not called, modals untouched)', () => {
      // No active stream, no modal — Escape should be a complete no-op.
      render(<Harness />);
      dispatchEscape();

      expect(coordinationMock.stopStream).not.toHaveBeenCalled();
    });
  });

  describe('Escape routing edge cases', () => {
    it(' Escape with no active conversation → stopStream not called even if activeStreams has stale entries', () => {
      useConversationStore.setState({ currentConversationId: null });
      // Stale entry in activeStreams that does NOT match any current conversation
      useStreamingStore.setState({
        activeStreams: { 'stale-conv': 'req-2' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(coordinationMock.stopStream).not.toHaveBeenCalled();
    });

    it(' Escape with Info modal open → closes Info and does not stop streaming', () => {
      useUIStore.setState({ activeModal: 'info' });
      useStreamingStore.setState({
        activeStreams: { 'conv-active': 'req-1' },
      });

      render(<Harness />);
      dispatchEscape();

      expect(coordinationMock.stopStream).not.toHaveBeenCalled();
      expect(useUIStore.getState().activeModal).toBe(null);
    });
  });

  describe('Cmd/Ctrl+B sidebar toggle', () => {
    const dispatchToggleSidebar = (metaKey = true) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: metaKey, metaKey }));
    };

    beforeEach(() => {
      settingsState.globalSettings.sidebarCollapsed = false;
      settingsState.setGlobalSettings = vi.fn((next: typeof settingsState) => {
        settingsState.globalSettings = next.globalSettings ?? next;
      });
    });

    it('toggles sidebarCollapsed from false to true on Cmd+B', () => {
      render(<Harness />);
      dispatchToggleSidebar();

      expect(settingsState.setGlobalSettings).toHaveBeenCalledTimes(1);
      expect(settingsState.globalSettings.sidebarCollapsed).toBe(true);
    });

    it('toggles sidebarCollapsed from true to false on Cmd+B', () => {
      settingsState.globalSettings.sidebarCollapsed = true;
      render(<Harness />);
      dispatchToggleSidebar();

      expect(settingsState.globalSettings.sidebarCollapsed).toBe(false);
    });

    it('ignores B without Ctrl/Meta', () => {
      render(<Harness />);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

      expect(settingsState.setGlobalSettings).not.toHaveBeenCalled();
    });
  });
});
