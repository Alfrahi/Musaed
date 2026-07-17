import { vi } from 'vitest';

// Centralized store mocks to avoid hoisting issues

// Store hooks mocks
export const mockUseCurrentConversationId = vi.fn(() => 'conv1');
export const mockUseConversations = vi.fn(() => ({
  conv1: {
    id: 'conv1',
    title: 'Test',
    model: 'llama3',
    settings: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
}));
export const mockUseAddMessages = vi.fn();
export const mockUseUpdateLastMessage = vi.fn();
export const mockUseSelectedModel = vi.fn(() => 'llama3');
export const mockUseGlobalSettings = vi.fn(() => ({
  ollamaUrl: 'http://localhost:11434',
  systemPrompt: '',
  temperature: 0.7,
  numPredict: 100,
  numCtx: 2048,
  topK: 40,
  topP: 0.9,
  stop: [],
}));

// Conversation actions mock
export const mockConversationActions = {
  initiateStreaming: vi.fn().mockResolvedValue(undefined),
  stopStreaming: vi.fn(),
  createNewConversation: vi.fn(),
  deleteConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
  clearAllConversations: vi.fn(),
};

// Helper to create store mocks object
export const createStoreMocks = () => ({
  useCurrentConversationId: mockUseCurrentConversationId,
  useConversations: mockUseConversations,
  useAddMessages: mockUseAddMessages,
  useUpdateLastMessage: mockUseUpdateLastMessage,
  useSelectedModel: mockUseSelectedModel,
  useGlobalSettings: mockUseGlobalSettings,
  useConversationActions: () => mockConversationActions,
});
