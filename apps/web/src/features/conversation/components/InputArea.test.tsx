import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import InputArea from './InputArea';
import { useChatInput } from '@/features/conversation/hooks/useChatInput';

// Mock the hooks
vi.mock('@/features/conversation/hooks/useChatInput');
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    formatNumber: (num: number) => num.toString(),
    formatDate: (date: number | Date) => String(date),
    isRtl: false,
    formatFileSize: (bytes: number) => `${bytes} B`,
  }),
}));

vi.mock('@/features/library', () => ({
  ModelSelector: () => <div data-testid="model-selector">ModelSelector</div>,
}));

vi.mock('@/features/rag', () => ({
  RagContextBadge: () => <div data-testid="rag-context-badge">RagContextBadge</div>,
}));

describe('InputArea', () => {
  beforeEach(() => {
    clearMocks();
    // Default mock implementation
    vi.mocked(useChatInput).mockReturnValue({
      input: '',
      setInput: vi.fn(),
      textareaRef: { current: null },
      isStreaming: false,
      selectedModel: 'llama3',
      images: [],
      files: [],
      onSend: vi.fn(),
      handleKeyDown: vi.fn(),
      handleTauriImageUpload: vi.fn(),
      handleTauriFileUpload: vi.fn(),
      removeImage: vi.fn(),
      removeFile: vi.fn(),
      t: (key: string) => key,
      currentConversationId: 'test-id',
      enterToSend: true,
    });
  });

  describe('Basic rendering', () => {
    it('renders input area with placeholder', () => {
      render(<InputArea />);
      const textarea = screen.getByPlaceholderText('chat.askAnything');
      expect(textarea).toBeInTheDocument();
    });
  });

  describe('Send button', () => {
    it('renders send button disabled when input is empty', () => {
      render(<InputArea />);
      const sendButton = screen.getByRole('button', { name: 'chat.send' });
      expect(sendButton).toBeDisabled();
    });

    it('renders send button enabled when input has text', () => {
      vi.mocked(useChatInput).mockReturnValue({
        ...vi.mocked(useChatInput)(),
        input: 'Test message',
      });

      render(<InputArea />);
      const sendButton = screen.getByRole('button', { name: 'chat.send' });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('RTL support', () => {
    it('applies mirror-rtl class to send icon when RTL is enabled', () => {
      vi.mock('@/lib/i18n', () => ({
        useTranslation: () => ({
          t: (key: string) => key,
          formatNumber: (num: number) => num.toString(),
          formatDate: (date: number | Date) => String(date),
          isRtl: true,
          formatFileSize: (bytes: number) => `${bytes} B`,
        }),
      }));

      render(<InputArea />);
      const icon = screen.getByRole('button', { name: 'chat.send' });
      const svg = icon.querySelector('svg');
      expect(svg?.classList.contains('mirror-rtl')).toBe(true);
    });
  });

  describe('Attachment buttons', () => {
    it('renders image attachment button', () => {
      render(<InputArea />);
      const imageButton = screen.getByTitle('chat.attachImage');
      expect(imageButton).toBeInTheDocument();
    });

    it('renders file attachment button', () => {
      render(<InputArea />);
      const fileButton = screen.getByTitle('common.files');
      expect(fileButton).toBeInTheDocument();
    });
  });

  describe('Streaming state', () => {
    it('shows stop button instead of send button during streaming', () => {
      vi.mocked(useChatInput).mockReturnValue({
        ...vi.mocked(useChatInput)(),
        isStreaming: true,
        input: 'Test',
      });

      render(<InputArea />);
      const stopButton = screen.getByRole('button', { name: /common.done/i });
      expect(stopButton).toBeInTheDocument();
    });
  });

  describe('Submit functionality', () => {
    it('calls onSend when submit button is clicked', () => {
      const onSend = vi.fn();
      vi.mocked(useChatInput).mockReturnValue({
        ...vi.mocked(useChatInput)(),
        input: 'Test message',
        onSend,
      });

      render(<InputArea />);
      const sendButton = screen.getByRole('button', { name: 'chat.send' });
      fireEvent.click(sendButton);
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('prevents submission when input is empty', () => {
      const onSend = vi.fn();
      vi.mocked(useChatInput).mockReturnValue({
        ...vi.mocked(useChatInput)(),
        input: '',
        onSend,
      });

      render(<InputArea />);
      // The form should not call onSend when input is empty
      // This is already tested by the disabled state of the send button
      const sendButton = screen.getByRole('button', { name: 'chat.send' });
      expect(sendButton).toBeDisabled();
    });
  });
});
