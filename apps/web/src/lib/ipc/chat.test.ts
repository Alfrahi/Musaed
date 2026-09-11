import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandMap } from '@musaed/contracts';
import { IpcError } from '@musaed/contracts';

vi.mock('./transport', () => ({
  callInternal: vi.fn(),
}));

import { chatApi } from './chat';
import { callInternal } from './transport';

const payload = {
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2:latest',
  messages: [{ role: 'user', content: 'hello' }],
  requestId: 'req-1',
} as unknown as CommandMap['cmd_ollama_chat']['args'];

describe('chatApi.chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opts into throwOnError so backend failures are not collapsed to null', async () => {
    vi.mocked(callInternal).mockResolvedValue(true);

    await chatApi.chat(payload);

    expect(callInternal).toHaveBeenCalledWith('cmd_ollama_chat', payload, {
      throwOnError: true,
    });
  });

  it('propagates backend errors (e.g. num_ctx OOM) with their real message', async () => {
    const backendError = new IpcError({
      code: 'OLLAMA_ERROR',
      message: 'model requires more memory than available',
      requestId: 'req-1',
      context: undefined,
      isRetryable: false,
    });
    vi.mocked(callInternal).mockRejectedValue(backendError);

    await expect(chatApi.chat(payload)).rejects.toMatchObject({
      message: 'model requires more memory than available',
    });
  });
});
