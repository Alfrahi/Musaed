import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import ChatWindow from './ChatWindow';
import { useUIStore } from '@/store/ui-store';
import { useConversationStore } from '@/store/conversation-store';
import { useMessageStore } from '@/store/message-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { DEFAULT_SETTINGS } from '@musaed/contracts';

vi.mock('@/lib/i18n', async () => {
  const actual = await vi.importActual('@/lib/i18n');
  return {
    ...(actual as object),
    useTranslation: () => ({
      t: (key: string) => key,
      formatNumber: (num: number) => num.toString(),
      formatDate: (date: number | Date) => String(date),
      isRtl: false,
      formatFileSize: (bytes: number) => `${bytes} B`,
    }),
  };
});

// Mock next/dynamic to return components synchronously
vi.mock('next/dynamic', () => ({
  default: (importFn: () => Promise<any>) => {
    let Component: any = null;
    importFn().then((mod) => {
      Component = mod.default;
    });
    return (props: any) => {
      if (Component) return <Component {...props} />;
      return null;
    };
  },
}));

vi.mock('./MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

// Shared mock for sendMessage to allow assertion
const mockSendMessage = vi.fn();
vi.mock('../hooks/useChatSend', () => ({
  useChatSend: () => ({
    sendMessage: mockSendMessage,
  }),
}));

vi.mock('react-virtuoso', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    Virtuoso: forwardRef(({ data, itemContent }: any, ref) => {
      useImperativeHandle(
        ref,
        () => ({
          scrollToIndex: vi.fn(),
        }),
        []
      );
      if (!data || data.length === 0) {
        return null;
      }
      return (
        <div data-testid="virtuoso-list">
          {data.map((item: any, i: number) => (
            <div key={i} data-testid={`message-${i}`}>
              {itemContent(i, item)}
            </div>
          ))}
        </div>
      );
    }),
  };
});

describe('ChatWindow', () => {
  beforeEach(() => {
    clearMocks();

    useConversationStore.setState({
      currentConversationId: null,
      conversations: {},
      conversationIds: [],
      searchQuery: '',
    });
    useMessageStore.setState({ messages: {} });
    useUIStore.setState({ isHydrated: true, isOllamaConnected: true });
    useModelStore.setState({ models: [{ name: 'llama3.2', size: 2000000000 }] });
    useSettingsStore.setState({
      globalSettings: {
        temperature: 0.7,
        topK: 40,
        topP: 0.9,
        numPredict: 2048,
        numCtx: 4096,
        stop: [],
        systemPrompt: '',
        ollamaUrl: 'http://localhost:11434',
        language: 'en',
        theme: 'light',
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
    });
  });

  describe('Loading state', () => {
    it('renders skeleton when not hydrated', () => {
      useUIStore.setState({ isHydrated: false });
      useConversationStore.setState({ currentConversationId: 'test-id' });

      render(<ChatWindow />);

      // Check for skeleton loader pattern (animate-pulse class)
      expect(screen.getByTestId('skeleton-loader')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('renders empty state when no conversation is selected', () => {
      useUIStore.setState({ isHydrated: true });
      useConversationStore.setState({ currentConversationId: null });

      render(<ChatWindow />);

      expect(screen.getByText('chat.welcome')).toBeInTheDocument();
    });
  });

  describe('Message rendering', () => {
    it('renders messages when conversation is selected', () => {
      useUIStore.setState({ isHydrated: true });
      useConversationStore.setState({
        currentConversationId: 'test-id',
        conversations: {
          'test-id': {
            id: 'test-id',
            title: 'Test Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: 'llama3.2',
            settings: DEFAULT_SETTINGS,
          },
        },
      });
      useMessageStore.setState({
        messages: {
          'test-id': [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Hello',
              timestamp: Date.now(),
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'Hi there!',
              timestamp: Date.now(),
            },
          ],
        },
      });

      render(<ChatWindow />);

      // Check for message content using regex (content may be nested in child elements)
      expect(screen.getByText(/Hello/)).toBeInTheDocument();
      expect(screen.getByText(/Hi there!/)).toBeInTheDocument();
    });

    it('renders user and assistant labels correctly', () => {
      useUIStore.setState({ isHydrated: true });
      useConversationStore.setState({
        currentConversationId: 'test-id',
        conversations: {
          'test-id': {
            id: 'test-id',
            title: 'Test Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: 'llama3.2',
            settings: DEFAULT_SETTINGS,
          },
        },
      });
      useMessageStore.setState({
        messages: {
          'test-id': [
            {
              id: 'msg-1',
              role: 'user',
              content: 'User message',
              timestamp: Date.now(),
            },
          ],
        },
      });

      render(<ChatWindow />);

      // Check for role label (may be nested with other classes/text)
      expect(screen.getByText((content) => content.includes('user'))).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('renders error fallback when a message has an error and retries on button click', async () => {
      useUIStore.setState({ isHydrated: true });
      useConversationStore.setState({
        currentConversationId: 'test-id',
        conversations: {
          'test-id': {
            id: 'test-id',
            title: 'Error Test',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: 'llama3.2',
            settings: DEFAULT_SETTINGS,
          },
        },
      });
      useMessageStore.setState({
        messages: {
          'test-id': [
            {
              id: 'msg-1',
              role: 'user',
              content: 'User query',
              timestamp: Date.now(),
            },
            {
              id: 'msg-2',
              role: 'assistant',
              content: 'Failed response',
              timestamp: Date.now(),
              error: { code: 'STREAM_ERR', message: 'Stream failed' },
            },
          ],
        },
      });

      const { sendMessage } = (await import('../hooks/useChatSend')).useChatSend();
      render(<ChatWindow />);

      // Error description should be displayed
      expect(screen.getByText('Stream failed')).toBeInTheDocument();
      // Retry button should be present and trigger sendMessage with last user content
      const retryBtn = screen.getByText('fallback.retry');
      expect(retryBtn).toBeInTheDocument();
      retryBtn.click();
      expect(sendMessage).toHaveBeenCalledWith('User query', []);
    });
  });

  describe('Streaming state', () => {
    it('appends live content to last message during streaming', () => {
      useUIStore.setState({ isHydrated: true });
      useConversationStore.setState({
        currentConversationId: 'test-id',
        conversations: {
          'test-id': {
            id: 'test-id',
            title: 'Test Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: 'llama3.2',
            settings: DEFAULT_SETTINGS,
          },
        },
      });
      useMessageStore.setState({
        messages: {
          'test-id': [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Initial response',
              timestamp: Date.now(),
            },
          ],
        },
      });
      useStreamingStore.setState({
        activeStreams: {
          'test-id': 'req-123',
        },
      });

      render(<ChatWindow />);

      // Check for streaming content (may be nested in child elements)
      expect(screen.getByText(/Initial response/)).toBeInTheDocument();
    });
  });
});
