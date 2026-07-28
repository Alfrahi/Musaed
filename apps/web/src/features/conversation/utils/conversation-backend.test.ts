import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IPC layer
vi.mock('@/lib/ipc', () => ({
  conversationApi: {
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
    appendMessage: vi.fn(),
    deleteConversation: vi.fn(),
    clearAllConversations: vi.fn(),
    updateConversation: vi.fn(),
  },
}));

import {
  initializeConversations,
  loadConversation,
  createConversation,
  addMessage,
  deleteConversation,
  clearAllConversations,
  updateConversation,
} from './conversation-backend';
import { conversationApi } from '@/lib/ipc';
import type { Conversation, Message } from '@musaed/contracts';

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
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };

  const mockMessage: Message = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
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
        'Failed to initialize conversations from backend:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('loadConversation', () => {
    it('should return full conversation with messages on success', async () => {
      vi.mocked(conversationApi.getConversation).mockResolvedValue(mockConversation);

      const result = await loadConversation('test-1');

      expect(result).toEqual(mockConversation);
      expect(conversationApi.getConversation).toHaveBeenCalledWith('test-1');
    });

    it('should return null on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.getConversation).mockRejectedValue(new Error('Not found'));

      const result = await loadConversation('test-1');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('createConversation', () => {
    it('should return conversation ID on success', async () => {
      vi.mocked(conversationApi.createConversation).mockResolvedValue('test-1');

      const result = await createConversation(mockConversation);

      expect(result).toBe('test-1');
      expect(conversationApi.createConversation).toHaveBeenCalledWith(mockConversation);
    });

    it('should return null on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.createConversation).mockRejectedValue(new Error('DB error'));

      const result = await createConversation(mockConversation);

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('addMessage', () => {
    it('should return true on success', async () => {
      vi.mocked(conversationApi.appendMessage).mockResolvedValue(undefined);

      const result = await addMessage('test-1', mockMessage);

      expect(result).toBe(true);
      expect(conversationApi.appendMessage).toHaveBeenCalledWith('test-1', mockMessage);
    });

    it('should return false on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.appendMessage).mockRejectedValue(new Error('DB error'));

      const result = await addMessage('test-1', mockMessage);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('deleteConversation', () => {
    it('should return true on success', async () => {
      vi.mocked(conversationApi.deleteConversation).mockResolvedValue(undefined);

      const result = await deleteConversation('test-1');

      expect(result).toBe(true);
      expect(conversationApi.deleteConversation).toHaveBeenCalledWith('test-1');
    });

    it('should return false on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.deleteConversation).mockRejectedValue(new Error('DB error'));

      const result = await deleteConversation('test-1');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('clearAllConversations', () => {
    it('should return true on success', async () => {
      vi.mocked(conversationApi.clearAllConversations).mockResolvedValue(undefined);

      const result = await clearAllConversations();

      expect(result).toBe(true);
      expect(conversationApi.clearAllConversations).toHaveBeenCalled();
    });

    it('should return false on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.clearAllConversations).mockRejectedValue(new Error('DB error'));

      const result = await clearAllConversations();

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('updateConversation', () => {
    it('should return true on success', async () => {
      vi.mocked(conversationApi.updateConversation).mockResolvedValue(undefined);

      const result = await updateConversation('test-1', 'New Title', Date.now());

      expect(result).toBe(true);
      expect(conversationApi.updateConversation).toHaveBeenCalledWith(
        'test-1',
        'New Title',
        expect.any(Number)
      );
    });

    it('should return false on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(conversationApi.updateConversation).mockRejectedValue(new Error('DB error'));

      const result = await updateConversation('test-1', 'New Title', Date.now());

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
