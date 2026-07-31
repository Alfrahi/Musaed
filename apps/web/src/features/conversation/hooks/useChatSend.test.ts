// Tests for useChatSend — the send pipeline (validation → RAG → messages → chatApi → persist).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './useChatActions/shared/setup';
import { mockAllDependencies, mockIpc, mockStores, mockUtils } from './useChatActions/shared/mocks';

// Mock the sibling hooks so useChatSend's compose boundary is tested in isolation.
const chatRagMock = vi.hoisted(() => ({ assembleChatRag: vi.fn() }));
const chatStreamMock = vi.hoisted(() => ({
  handleStreamError: vi.fn(),
  abortMessage: vi.fn(),
}));
vi.mock('./useChatRag', () => ({ useChatRag: () => chatRagMock }));
vi.mock('./useChatStream', () => ({ useChatStream: () => chatStreamMock }));

import { useChatSend } from './useChatSend';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  // Default happy-path RAG stub.
  chatRagMock.assembleChatRag.mockResolvedValue({ ragSources: undefined });
});

describe('useChatSend', () => {
  it('sends a message: validates, creates messages, calls chatApi, persists', async () => {
    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    // Messages created and added to the message store
    expect(mockStores.messageStore.addMessages).toHaveBeenCalledTimes(1);
    expect(mockStores.messageStore.addMessages).toHaveBeenCalledWith(
      'conv1',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'hello' }),
        expect.objectContaining({ role: 'assistant', content: '' }),
      ])
    );
    // chatApi.chat called with the right payload
    expect(mockIpc.chatApi.chat).toHaveBeenCalledTimes(1);
    expect(mockIpc.chatApi.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:11434',
        messages: [{ role: 'user', content: 'hello' }],
        model: 'llama3',
      })
    );
    // User message persisted
    expect(mockUtils.persistUserMessage).toHaveBeenCalled();
    // No error path taken
    expect(chatStreamMock.handleStreamError).not.toHaveBeenCalled();
  });

  it('injects file attachments into the prompt', async () => {
    const { result } = renderHook(() => useChatSend());
    const files = [{ name: 'note.txt', content: 'file body', size: 9, type: 'text/plain' }];

    await act(async () => {
      await result.current.sendMessage('see attachment', [], files);
    });

    const payload = mockIpc.chatApi.chat.mock.calls[0][0];
    expect(payload.messages[0].content).toContain('File: note.txt');
    expect(payload.messages[0].content).toContain('file body');
  });

  it('attaches RAG sources to the assistant message when RAG returns citations', async () => {
    chatRagMock.assembleChatRag.mockResolvedValue({
      ragSources: [{ filePath: '/a.ts', startLine: 1, endLine: 2, language: 'typescript' }],
    });

    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('query');
    });

    const [, assistantMsg] = mockStores.messageStore.addMessages.mock.calls[0][1];
    expect(assistantMsg.ragSources).toEqual([
      { filePath: '/a.ts', startLine: 1, endLine: 2, language: 'typescript' },
    ]);
  });

  it('routes chatApi failures to useChatStream.handleStreamError', async () => {
    mockIpc.chatApi.chat.mockRejectedValue(new Error('API failure'));

    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(chatStreamMock.handleStreamError).toHaveBeenCalledTimes(1);
    expect(chatStreamMock.handleStreamError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(chatStreamMock.handleStreamError.mock.calls[0][1]).toBe('conv1');
  });

  it('continues the send when RAG assembly returns null (no active project)', async () => {
    chatRagMock.assembleChatRag.mockResolvedValue({ ragSources: undefined });

    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(mockIpc.chatApi.chat).toHaveBeenCalled();
    expect(mockStores.messageStore.addMessages).toHaveBeenCalled();
  });

  it('throws when chatApi.chat returns non-true (connection failure)', async () => {
    mockIpc.chatApi.chat.mockResolvedValue(false);

    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    // handleStreamError receives the connectionFailed error
    expect(chatStreamMock.handleStreamError).toHaveBeenCalledTimes(1);
    expect(chatStreamMock.handleStreamError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
