// Tests for ChatSendService — the framework-agnostic send pipeline.
// No React rendering required; store access is mocked via getState().
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_MODEL_PARAMS } from '@musaed/contracts';
import type { Message } from '@musaed/contracts';

// --- Hoisted mocks ---------------------------------------------------------
// vi.mock factories are hoisted above all other code, so any variable they
// reference must itself be hoisted via vi.hoisted(). The store state objects
// are mutable — tests and beforeEach reassign their properties directly.

const messageStoreActions = vi.hoisted(() => ({
  addMessages: vi.fn(),
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  removeMessage: vi.fn(),
  updateLastMessage: vi.fn(),
}));

const messageStoreState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  messages: {} as Record<string, Message[]>,
}));

const conversationStoreState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  currentConversationId: 'conv1' as string | null,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  conversations: {
    conv1: {
      id: 'conv1',
      title: 'Test',
      model: 'llama3',
      settings: {},
      createdAt: 0,
      updatedAt: 0,
    },
  } as Record<string, unknown>,
}));

const settingsStoreState = vi.hoisted(() => ({
  globalSettings: {
    language: 'en',
    ollamaUrl: 'http://localhost:11434',
    stop: [] as string[],
    systemPrompt: '',
  },
}));

const modelStoreState = vi.hoisted(() => ({
  selectedModel: 'llama3',
}));

const mockChatApi = vi.hoisted(() => ({
  chat: vi.fn().mockResolvedValue(true),
  abort: vi.fn(),
}));

const mockConversationApi = vi.hoisted(() => ({
  deleteMessage: vi.fn().mockResolvedValue(undefined),
}));

const mockPersistUserMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStopStream = vi.hoisted(() => vi.fn());
const mockLogger = vi.hoisted(() => ({ error: vi.fn() }));
const mockSelectResolvedParams = vi.hoisted(() =>
  vi.fn((_model: string, _ctx: number | null, _dp: unknown) => DEFAULT_MODEL_PARAMS)
);

// --- vi.mock calls (hoisted) -----------------------------------------------

vi.mock('@/store/message-store', () => ({
  useMessageStore: {
    getState: () => ({ ...messageStoreState, ...messageStoreActions }),
  },
}));

vi.mock('@/store/conversation-store', () => ({
  useConversationStore: {
    getState: () => conversationStoreState,
  },
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: {
    getState: () => settingsStoreState,
  },
}));

vi.mock('@/store/model-store', () => ({
  useModelStore: {
    getState: () => modelStoreState,
  },
}));

vi.mock('@/store/model-params-store', () => ({
  selectResolvedParams: (modelName: string, ctx: number | null, dp: unknown) =>
    mockSelectResolvedParams(modelName, ctx, dp),
}));

vi.mock('@/store/coordination', () => ({
  stopStream: (...args: unknown[]) => mockStopStream(...(args as [string, string, string?])),
}));

vi.mock('@/lib/ipc', () => ({
  chatApi: mockChatApi,
  conversationApi: mockConversationApi,
}));

vi.mock('@/features/conversation/utils/message-persistence', () => ({
  persistUserMessage: (...args: unknown[]) => mockPersistUserMessage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

// Import after mocks are in place.
import { ChatSendService } from './ChatSendService';

// --- Injected hook deps (not module-level vi.mock, just plain consts) ------

const mockT = vi.fn((key: string, values?: Record<string, string | number | boolean>) => {
  if (key === 'chat.fileLabel' && values?.name) return `File: ${values.name}`;
  if (key === 'chat.contentLabel') return 'Content:';
  if (key === 'chat.fileContextLabel') return 'File Context:';
  if (key === 'chat.noModelSelected') return 'No model selected';
  if (key === 'chat.connectionFailed') return 'Connection failed';
  if (key === 'chat.messageTooLong') return `Message too long (max ${values?.limit}KB)`;
  return key;
});

const mockAssembleChatRag = vi.fn().mockResolvedValue({ ragSources: undefined });
const mockHandleStreamError = vi.fn();
const mockInitiateStreaming = vi.fn();

// --- Test helper ------------------------------------------------------------

function createService(
  overrides?: Partial<{
    contextWindow: number | null;
    defaultParams: typeof DEFAULT_MODEL_PARAMS | null;
    paramsStop: string[];
    t: typeof mockT;
    assembleChatRag: typeof mockAssembleChatRag;
    handleStreamError: typeof mockHandleStreamError;
    initiateStreaming: typeof mockInitiateStreaming;
  }>
) {
  return new ChatSendService({
    t: overrides?.t ?? mockT,
    assembleChatRag: overrides?.assembleChatRag ?? mockAssembleChatRag,
    handleStreamError: overrides?.handleStreamError ?? mockHandleStreamError,
    initiateStreaming: overrides?.initiateStreaming ?? mockInitiateStreaming,
    contextWindow: overrides?.contextWindow ?? 4096,
    defaultParams: overrides?.defaultParams ?? DEFAULT_MODEL_PARAMS,
    paramsStop: overrides?.paramsStop ?? [],
  });
}

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Reset state snapshots
  messageStoreState.messages = { conv1: [] };
  conversationStoreState.currentConversationId = 'conv1';
  conversationStoreState.conversations = {
    conv1: {
      id: 'conv1',
      title: 'Test',
      model: 'llama3',
      settings: {},
      createdAt: 0,
      updatedAt: 0,
    },
  };
  settingsStoreState.globalSettings.ollamaUrl = 'http://localhost:11434';
  settingsStoreState.globalSettings.stop = [];
  settingsStoreState.globalSettings.systemPrompt = '';
  modelStoreState.selectedModel = 'llama3';

  mockChatApi.chat.mockResolvedValue(true);
  mockAssembleChatRag.mockResolvedValue({ ragSources: undefined });
  mockPersistUserMessage.mockResolvedValue(undefined);
  mockSelectResolvedParams.mockReturnValue(DEFAULT_MODEL_PARAMS);
  mockConversationApi.deleteMessage.mockResolvedValue(undefined);
});

describe('ChatSendService.sendMessage', () => {
  it('validates, creates messages, calls chatApi, and persists', async () => {
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockInitiateStreaming).toHaveBeenCalledWith('conv1', expect.any(String));
    expect(messageStoreActions.addMessages).toHaveBeenCalledWith(
      'conv1',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'hello' }),
        expect.objectContaining({ role: 'assistant', content: '' }),
      ])
    );
    expect(mockChatApi.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      })
    );
    const payload = mockChatApi.chat.mock.calls[0][0];
    // With no system prompt and no history, the payload is a single user message.
    expect(payload.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(mockPersistUserMessage).toHaveBeenCalled();
    expect(mockHandleStreamError).not.toHaveBeenCalled();
  });

  it('injects file attachments into the prompt', async () => {
    const service = createService();
    const files = [{ name: 'note.txt', content: 'file body', size: 9, type: 'text/plain' }];

    await service.sendMessage({ input: 'see attachment', files });

    const payload = mockChatApi.chat.mock.calls[0][0];
    expect(payload.messages[0].content).toContain('File: note.txt');
    expect(payload.messages[0].content).toContain('file body');
  });

  it('attaches RAG sources to the assistant message when RAG returns citations', async () => {
    mockAssembleChatRag.mockResolvedValue({
      ragSources: [{ filePath: '/a.ts', startLine: 1, endLine: 2, language: 'typescript' }],
    });

    const service = createService();
    await service.sendMessage({ input: 'query' });

    const [, assistantMsg] = messageStoreActions.addMessages.mock.calls[0][1];
    expect(assistantMsg.ragSources).toEqual([
      { filePath: '/a.ts', startLine: 1, endLine: 2, language: 'typescript' },
    ]);
  });

  it('prepends system prompt as a system message when globalSettings.systemPrompt is set', async () => {
    settingsStoreState.globalSettings.systemPrompt = 'You are a helpful assistant.';
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    const payload = mockChatApi.chat.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
    // Current user message is still the last element.
    expect(payload.messages[payload.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hello',
    });
  });

  it('injects RAG assembled context as a system message before the user message', async () => {
    mockAssembleChatRag.mockResolvedValue({
      ragSources: [{ filePath: '/a.ts', startLine: 1, endLine: 2, language: 'typescript' }],
      assembledContext: 'RAG context: relevant code snippet',
      ragTokenCount: 10,
    });
    const service = createService();

    await service.sendMessage({ input: 'query' });

    const payload = mockChatApi.chat.mock.calls[0][0];
    // Without system prompt: [ragSystemMessage, userMessage]
    expect(payload.messages).toEqual([
      { role: 'system', content: 'RAG context: relevant code snippet' },
      { role: 'user', content: 'query' },
    ]);
  });

  it('includes conversation history before the current user message', async () => {
    const priorUser: Message = {
      id: 'u1',
      role: 'user',
      content: 'previous question',
      timestamp: 1,
      requestId: 'req-1',
    };
    const priorAssistant: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'previous answer',
      timestamp: 2,
      model: 'llama3',
      requestId: 'req-1',
      done: true,
    };
    messageStoreState.messages = { conv1: [priorUser, priorAssistant] };
    const service = createService();

    await service.sendMessage({ input: 'follow up' });

    const payload = mockChatApi.chat.mock.calls[0][0];
    // [priorUser, priorAssistant, currentUserMessage]
    expect(payload.messages).toEqual([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'follow up' },
    ]);
  });

  it('combines system prompt, history, RAG context, and current message in order', async () => {
    settingsStoreState.globalSettings.systemPrompt = 'System instructions';
    mockAssembleChatRag.mockResolvedValue({
      ragSources: undefined,
      assembledContext: 'RAG snippet',
      ragTokenCount: 5,
    });
    const priorUser: Message = {
      id: 'u1',
      role: 'user',
      content: 'old question',
      timestamp: 1,
      requestId: 'req-1',
    };
    const priorAssistant: Message = {
      id: 'a1',
      role: 'assistant',
      content: 'old answer',
      timestamp: 2,
      model: 'llama3',
      requestId: 'req-1',
      done: true,
    };
    messageStoreState.messages = { conv1: [priorUser, priorAssistant] };
    const service = createService();

    await service.sendMessage({ input: 'new question' });

    const payload = mockChatApi.chat.mock.calls[0][0];
    expect(payload.messages).toEqual([
      { role: 'system', content: 'System instructions' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'system', content: 'RAG snippet' },
      { role: 'user', content: 'new question' },
    ]);
  });

  it('routes chatApi failures to handleStreamError', async () => {
    mockChatApi.chat.mockRejectedValue(new Error('API failure'));
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockHandleStreamError).toHaveBeenCalledTimes(1);
    expect(mockHandleStreamError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(mockHandleStreamError.mock.calls[0][1]).toBe('conv1');
  });

  it('throws when chatApi.chat returns non-true (connection failure)', async () => {
    mockChatApi.chat.mockResolvedValue(false);
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockHandleStreamError).toHaveBeenCalledTimes(1);
    expect(mockHandleStreamError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('continues the send when RAG assembly returns undefined sources', async () => {
    mockAssembleChatRag.mockResolvedValue({ ragSources: undefined });
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockChatApi.chat).toHaveBeenCalled();
    expect(messageStoreActions.addMessages).toHaveBeenCalled();
  });

  it('cleans up orphaned stream via stopStream(batch-end) when RAG assembly throws', async () => {
    mockAssembleChatRag.mockRejectedValue(new Error('RAG failed'));
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockStopStream).toHaveBeenCalledWith('conv1', 'batch-end', expect.any(String));
    expect(mockChatApi.chat).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Chat send failed before stream start',
      expect.objectContaining({ conversationId: 'conv1' })
    );
  });

  it('skips send when no model is selected', async () => {
    modelStoreState.selectedModel = '';
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
    expect(mockT).toHaveBeenCalledWith('chat.noModelSelected');
  });

  it('skips send when no conversation is selected', async () => {
    conversationStoreState.currentConversationId = null;
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });

  it('skips send when input and attachments are empty', async () => {
    const service = createService();

    await service.sendMessage({ input: '   ' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });

  it('skips send when conversation does not exist in store', async () => {
    conversationStoreState.conversations = {};
    const service = createService();

    await service.sendMessage({ input: 'hello' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });

  it('rejects messages exceeding the max content length', async () => {
    const service = createService();

    await service.sendMessage({ input: 'x'.repeat(300000) });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
    expect(mockT).toHaveBeenCalledWith(
      'chat.messageTooLong',
      expect.objectContaining({ limit: expect.any(Number) })
    );
  });
});

describe('ChatSendService.editAndResend', () => {
  it('updates the user message, removes old assistant, and re-streams', async () => {
    const userMsg: Message = {
      id: 'msg-user-1',
      role: 'user',
      content: 'old content',
      timestamp: 1,
      requestId: 'req-old',
    };
    const oldAssistant: Message = {
      id: 'msg-asst-1',
      role: 'assistant',
      content: 'old response',
      timestamp: 2,
      model: 'llama3',
      requestId: 'req-old',
    };
    messageStoreState.messages = { conv1: [userMsg, oldAssistant] };

    const service = createService();

    await service.editAndResend({
      editedMessageId: 'msg-user-1',
      newContent: 'edited content',
    });

    expect(mockInitiateStreaming).toHaveBeenCalledWith('conv1', expect.any(String));
    expect(messageStoreActions.updateMessage).toHaveBeenCalledWith(
      'conv1',
      'msg-user-1',
      expect.objectContaining({ content: 'edited content' })
    );
    expect(mockPersistUserMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ id: 'msg-user-1', content: 'edited content' })
    );
    expect(messageStoreActions.removeMessage).toHaveBeenCalledWith('conv1', 'msg-asst-1');
    expect(mockConversationApi.deleteMessage).toHaveBeenCalledWith('conv1', 'msg-asst-1');
    expect(messageStoreActions.addMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ role: 'assistant', content: '' })
    );
    expect(mockChatApi.chat).toHaveBeenCalled();
  });

  it('skips when no conversation is selected', async () => {
    conversationStoreState.currentConversationId = null;
    const service = createService();

    await service.editAndResend({ editedMessageId: 'msg-1', newContent: 'x' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });

  it('skips when edited message is not found or not a user message', async () => {
    messageStoreState.messages = { conv1: [] };
    const service = createService();

    await service.editAndResend({ editedMessageId: 'nonexistent', newContent: 'x' });

    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });

  it('cleans up orphaned stream when RAG assembly throws after initiateStreaming', async () => {
    mockAssembleChatRag.mockRejectedValue(new Error('RAG failed'));
    const service = createService();

    await service.editAndResend({ editedMessageId: 'msg-1', newContent: 'x' });

    expect(mockStopStream).toHaveBeenCalledWith('conv1', 'batch-end', expect.any(String));
    expect(mockChatApi.chat).not.toHaveBeenCalled();
  });
});
