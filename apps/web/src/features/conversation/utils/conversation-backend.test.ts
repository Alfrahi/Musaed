import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IPC layer
vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    listConversations: vi.fn(),
  },
}));

import { initializeConversations } from './conversation-backend';
import { conversationApi } from '@/lib/ipc';
import type { Conversation } from '@musaed/contracts';

describe('Conversation Backend Service', () => {
  const mockConversation: Conversation = {
    id: 'test-1',
    title: 'Test Conversation',
    model: 'llama3',
    settings: {
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
      numPredict: 2048,
      numCtx: 4096,
      stop: [],
      systemPrompt: '',
      ollamaUrl: 'http://localhost:11434',
      language: 'en',
      theme: 'system',
      hasDetectedLanguage: false,
      enterToSend: true,
      chatRetentionDays: 0,
      enableLatex: false,
      enableMermaid: true,
      density: 1.0,
      sidebarWidth: 260,
      sidebarCollapsed: false,
      closeToTray: true,
      showTokenIndicator: true,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initializeConversations', () => {
    it('should return conversations metadata without messages on success', async () => {
      vi.mocked(conversationApi.listConversations).mockResolvedValue([mockConversation]);

      const result = await initializeConversations();

      expect(result).toHaveLength(1);
      expect(result?.[0]).toEqual({
        id: mockConversation.id,
        title: mockConversation.title,
        model: mockConversation.model,
        settings: mockConversation.settings,
        createdAt: mockConversation.createdAt,
        updatedAt: mockConversation.updatedAt,
      });
      expect(result?.[0]).not.toHaveProperty('messages');
    });

    it('should return null when API returns null', async () => {
      vi.mocked(conversationApi.listConversations).mockResolvedValue(null);

      const result = await initializeConversations();

      expect(result).toBeNull();
    });

    it('should return null and log error on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.listConversations).mockRejectedValue(new Error('Network error'));

      const result = await initializeConversations();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ERROR] Failed to initialize conversations from backend:',
        { error: 'Error: Network error' }
      );
      consoleSpy.mockRestore();
    });
  });
});
