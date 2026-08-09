// Tests for the useChatSend hook facade.
//
// The send-pipeline logic is tested in ChatSendService.test.ts.
// These tests verify that the hook:
//  - returns sendMessage / editAndResend functions with the right signatures
//  - delegates to ChatSendService with the right params
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from './shared/setup';
import { mockAllDependencies } from './shared/mocks';

// Mock the sibling hooks so the facade's compose boundary is tested in
// isolation.
const chatRagMock = vi.hoisted(() => ({ assembleChatRag: vi.fn() }));
const chatStreamMock = vi.hoisted(() => ({
  handleStreamError: vi.fn(),
  abortMessage: vi.fn(),
}));

// Mock ChatSendService to intercept the delegation. The mock must be a
// constructor (callable with `new`) that returns the service mock object.
const serviceMock = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  editAndResend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./useChatRag', () => ({ useChatRag: () => chatRagMock }));
vi.mock('./useChatStream', () => ({ useChatStream: () => chatStreamMock }));
vi.mock('../services/ChatSendService', () => ({
  ChatSendService: vi.fn().mockImplementation(function () {
    return serviceMock;
  }),
}));

import { useChatSend } from './useChatSend';
import { ChatSendService } from '../services/ChatSendService';

beforeEach(() => {
  mockAllDependencies();
  vi.clearAllMocks();
  chatRagMock.assembleChatRag.mockResolvedValue({ ragSources: undefined });
  serviceMock.sendMessage.mockResolvedValue(undefined);
  serviceMock.editAndResend.mockResolvedValue(undefined);
});

describe('useChatSend (facade)', () => {
  it('returns sendMessage and editAndResend functions', () => {
    const { result } = renderHook(() => useChatSend());

    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.editAndResend).toBe('function');
  });

  it('constructs a ChatSendService with the injected deps', () => {
    renderHook(() => useChatSend());

    expect(ChatSendService).toHaveBeenCalledTimes(1);
    const mockFn = vi.mocked(ChatSendService);
    const deps = mockFn.mock.calls[0][0];
    expect(deps).toHaveProperty('t');
    expect(deps).toHaveProperty('assembleChatRag', chatRagMock.assembleChatRag);
    expect(deps).toHaveProperty('handleStreamError', chatStreamMock.handleStreamError);
    expect(deps).toHaveProperty('initiateStreaming');
    expect(deps).toHaveProperty('contextWindow');
    expect(deps).toHaveProperty('defaultParams');
    expect(deps).toHaveProperty('paramsStop');
  });

  it('delegates sendMessage with input, images, and files', async () => {
    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage(
        'hello',
        ['img1'],
        [{ name: 'f.txt', content: 'body', size: 4, type: 'text/plain' }]
      );
    });

    expect(serviceMock.sendMessage).toHaveBeenCalledWith({
      input: 'hello',
      images: ['img1'],
      files: [{ name: 'f.txt', content: 'body', size: 4, type: 'text/plain' }],
    });
  });

  it('delegates editAndResend with editedMessageId, newContent, and images', async () => {
    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.editAndResend('msg-1', 'new text', ['img1']);
    });

    expect(serviceMock.editAndResend).toHaveBeenCalledWith({
      editedMessageId: 'msg-1',
      newContent: 'new text',
      images: ['img1'],
    });
  });

  it('passes default empty arrays when images and files are omitted', async () => {
    const { result } = renderHook(() => useChatSend());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(serviceMock.sendMessage).toHaveBeenCalledWith({
      input: 'hello',
      images: undefined,
      files: undefined,
    });
  });
});
