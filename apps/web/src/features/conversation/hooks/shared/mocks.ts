// Shared mocks for conversation hook tests
import { vi } from 'vitest';
import { DEFAULT_MODEL_PARAMS } from '@musaed/contracts';

// Zustand hooks accept an optional selector: `useStore((s) => s.foo)`.
// The mocks below replicate that — when called with a function, they apply
// it to the mock state; when called without, they return the full state.
// This is necessary because hooks like `useTokenUsage` use selectors
// like `useMessageStore((s) => s.messages[convId])` that must return the
// selected value, not the whole store object.
function selectorAware<T>(state: T) {
  return vi.fn((selector?: (s: T) => unknown) => (selector ? selector(state) : state));
}

// Mock translation hook
const mockTranslation = {
  t: vi.fn((key: string, values?: Record<string, string | number | boolean>) => {
    if (key === 'chat.fileLabel' && values?.name) {
      return `File: ${values.name}`;
    }
    if (key === 'chat.contentLabel') {
      return 'Content:';
    }
    if (key === 'chat.fileContextLabel') {
      return 'File Context:';
    }
    return key;
  }),
};

// Mock to handle the incorrect usage in production code
const mockSettingsState = {
  globalSettings: {
    language: 'en',
    ollamaUrl: 'http://localhost:11434',
    numCtx: 4096,
    enterToSend: true,
  },
  getState: () => mockSettingsState,
};

const mockUseSettingsStore = selectorAware(mockSettingsState);

// Mock IPC module
export const mockIpc = {
  checkIsTauri: vi.fn(() => true),
  chatApi: {
    chat: vi.fn().mockResolvedValue(true),
    abort: vi.fn(),
  },
  conversationApi: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn().mockResolvedValue('conv1'),
    appendMessage: vi.fn(),
    deleteConversation: vi.fn(),
    clearAllConversations: vi.fn(),
    updateConversation: vi.fn(),
  },
  ragApi: {
    search: vi.fn(),
    assembleContext: vi
      .fn()
      .mockResolvedValue({ assembled_context: '', citations: [], token_count: 0 }),
  },
  ollamaApi: {
    validateModel: vi.fn().mockResolvedValue(null),
  },
  store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue([]),
      set: vi.fn(),
      save: vi.fn(),
    }),
  },
  logApi: {
    append: vi.fn(),
    clear: vi.fn(),
  },
};

// Mock stores - direct store access
export const mockStores = {
  uiStore: {
    isStreaming: false,
    isHydrated: true,
    errorMessage: null,
    setStreaming: vi.fn(),
    setHydrated: vi.fn(),
    setErrorMessage: vi.fn(),
  },
  messageStore: {
    addMessage: vi.fn(),
    addMessages: vi.fn(),
    updateLastMessage: vi.fn(),
    messages: {
      conv1: [],
    },
    clearMessages: vi.fn(),
  },
  streamingStore: {
    appendToken: vi.fn(),
    setPendingMetrics: vi.fn(),
    flushToConversation: vi.fn().mockReturnValue({ content: '', metrics: {} }),
    startStream: vi.fn((conversationId: string, requestId: string) => {
      mockStores.streamingStore.activeStreams[conversationId] = requestId;
    }),
    stopStream: vi.fn(),
    clearStream: vi.fn(),
    markFlushed: vi.fn(),
    activeStreams: {
      conv1: 'request1',
    } as Record<string, string>,
  },
  modelStore: {
    selectedModel: 'llama3',
    projects: {},
    getState: vi.fn().mockReturnValue({
      selectedModel: 'llama3',
    }),
  },
  conversationStore: {
    conversations: {
      conv1: {
        id: 'conv1',
        title: 'Test Conversation',
        model: 'llama3',
        settings: { language: 'en' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
    currentConversationId: 'conv1',
    conversationIds: ['conv1'],
    updateConversation: vi.fn(),
    batchUpdate: vi.fn(),
    getState: vi.fn().mockImplementation(() => ({
      conversations: {
        conv1: {
          id: 'conv1',
          title: 'Test Conversation',
          model: 'llama3',
          settings: { language: 'en' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      currentConversationId: 'conv1',
      conversationIds: ['conv1'],
      updateConversation: vi.fn(),
      batchUpdate: vi.fn(),
    })),
  },
  settingsStore: {
    globalSettings: {
      language: 'en',
      ollamaUrl: 'http://localhost:11434',
      enterToSend: true,
    },
    getState: vi.fn().mockImplementation(() => mockStores.settingsStore),
  },
  ragStore: {
    activeProjectId: null,
    projects: {},
    getState: vi.fn().mockImplementation(() => ({
      activeProjectId: null,
      projects: {},
    })),
  },
};

// Mock store hooks
const mockStoreHooks = {
  useMessageStore: selectorAware({
    ...mockStores.messageStore,
    addMessages: mockStores.messageStore.addMessages,
    updateLastMessage: mockStores.messageStore.updateLastMessage,
  }),
  useStreamingStore: Object.assign(selectorAware(mockStores.streamingStore), {
    getState: () => mockStores.streamingStore,
  }),
  useModelStore: vi.fn(() => ({
    ...mockStores.modelStore,
    selectedModel: mockStores.modelStore.selectedModel,
  })),
  useConversationStore: selectorAware(mockStores.conversationStore),
  useSettingsStore: mockUseSettingsStore,
  useRagStore: vi.fn(() => ({
    ...mockStores.ragStore,
    activeProjectId: mockStores.ragStore.activeProjectId,
    projects: mockStores.ragStore.projects,
  })),
  useUpdateConversation: vi.fn(() => mockStores.conversationStore.updateConversation),
  useBatchUpdate: vi.fn(() => mockStores.conversationStore.batchUpdate),
  useCurrentConversationId: vi.fn(() => mockStores.conversationStore.currentConversationId),
  useConversations: vi.fn(() => mockStores.conversationStore.conversations),
};

// Mock utilities
export const mockUtils = {
  batchManager: {
    flushAndStop: vi.fn(),
  },
  coordination: {
    coordinateStartStream: vi.fn((conversationId: string, requestId: string) => {
      mockStores.uiStore.setStreaming(true);
      mockStores.streamingStore.startStream(conversationId, requestId);
    }),
    stopStream: vi.fn(),
    flushAndStop: vi.fn(),
  },
  persistUserMessage: vi.fn().mockResolvedValue(true),
  logger: {
    error: vi.fn(),
  },
};

// Mock all dependencies.
//
// `vi.mock` calls MUST live at the top level of the module so they are hoisted
// by Vitest before any test runs (calling them from inside a function would
// still hoist, but Vitest warns and a future version will error). The mock
// value consts above are module-level, so the deferred factory closures below
// see them initialized by the time the mocked modules are first imported.
//
// `mockAllDependencies()` is preserved as a no-op for backwards-compatibility
// with test files that call it from `beforeEach`. The mocks are installed at
// module load, so the call has no runtime effect — but the call sites should
// be left alone to minimize churn across the test suite.

vi.mock('@/lib/i18n', () => ({
  useTranslation: vi.fn((_lang: string) => mockTranslation),
}));

vi.mock('@/lib/ipc', () => ({
  __esModule: true,
  chatApi: mockIpc.chatApi,
  conversationApi: mockIpc.conversationApi,
  ragApi: mockIpc.ragApi,
  ollamaApi: mockIpc.ollamaApi,
  store: mockIpc.store,
  logApi: mockIpc.logApi,
  checkIsTauri: mockIpc.checkIsTauri,
}));

vi.mock('@/store/batch-manager', () => ({ flushAndStop: mockUtils.batchManager.flushAndStop }));

vi.mock('@/store/coordination', () => ({ ...mockUtils.coordination }));

vi.mock('@/store/ui-store', () => ({
  useUIStore: () => mockStores.uiStore,
  useSetUIError: () => mockStores.uiStore.setErrorMessage,
}));

vi.mock('@/store/message-store', () => ({
  useMessageStore: mockStoreHooks.useMessageStore,
}));

vi.mock('@/store/streaming-store', () => ({
  useStreamingStore: mockStoreHooks.useStreamingStore,
  selectIsLiveStreaming:
    (conversationId: string) => (state: { activeStreams: Record<string, string> }) =>
      conversationId in state.activeStreams,
}));

vi.mock('@/store/model-store', () => ({
  useModelStore: mockStoreHooks.useModelStore,
  useSelectedModel: vi.fn(() => mockStores.modelStore.selectedModel),
  getState: () => mockStores.modelStore,
  selectedModel: mockStores.modelStore.selectedModel,
}));

vi.mock('@/store/conversation-store', () => ({
  useConversationStore: mockStoreHooks.useConversationStore,
  useUpdateConversation: mockStoreHooks.useUpdateConversation,
  useBatchUpdate: mockStoreHooks.useBatchUpdate,
  useCurrentConversationId: mockStoreHooks.useCurrentConversationId,
  useConversations: mockStoreHooks.useConversations,
  useMessageStore: mockStoreHooks.useMessageStore,
  ...mockStores.conversationStore,
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: mockStoreHooks.useSettingsStore,
  useLanguage: vi.fn(() => 'en'),
  useOllamaUrl: vi.fn(() => 'http://localhost:11434'),
  useEnterToSend: () => mockStores.settingsStore.globalSettings.enterToSend,
  // Direct store access
  globalSettings: { ...mockStores.settingsStore.globalSettings, numCtx: 4096 },
}));

vi.mock('@/store/rag-store', () => ({
  useRagStore: mockStoreHooks.useRagStore,
  useActiveRagProject: vi.fn(() => null),
  // Direct store access
  getState: () => mockStores.ragStore,
  activeProjectId: mockStores.ragStore.activeProjectId,
}));

vi.mock('@/store/model-params-store', () => ({
  useModelParamsStore: selectorAware({ profiles: {} }),
  selectResolvedParams: vi.fn(() => DEFAULT_MODEL_PARAMS),
}));

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistUserMessage: mockUtils.persistUserMessage,
}));

vi.mock('@/lib/logger', () => ({ logger: mockUtils.logger }));

// No-op kept for backwards compatibility with test files that call
// `mockAllDependencies()` from `beforeEach`. The mocks above are installed at
// module load; this function is preserved only to avoid churning call sites.
export function mockAllDependencies() {
  // intentionally empty — mocks are hoisted to top level above
}
