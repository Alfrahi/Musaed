import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import InputArea from './InputArea';
import { useChatInput } from '@/features/conversation/hooks/useChatInput';

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

vi.mock('@/features/library', async () => {
  return {
    ModelSelector: () => <div data-testid="model-selector">ModelSelector</div>,
  };
});

vi.mock('@/features/rag', async () => {
  return {
    RagContextBadge: () => <div data-testid="rag-context-badge">RagContextBadge</div>,
  };
});

vi.mock('@/features/conversation/hooks/useChatInput', async () => {
  const actual = await vi.importActual('@/features/conversation/hooks/useChatInput');
  return {
    ...(actual as object),
    useChatInput: () => ({
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
    }),
  };
});

describe('InputArea', () => {
  beforeEach(() => {
    clearMocks();
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

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('renders send button enabled when input has text', () => {
      const setInput = vi.fn();
      vi.mocked(useChatInput).mockReturnValue({
        input: 'Test message',
        setInput,
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

      render(<InputArea />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe('RTL support', () => {
    it('applies mirror-rtl class to send icon when RTL is enabled', async () => {
      render(<InputArea />);

      const icon = screen.getByRole('button', { name: /send/i });
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
        input: 'Test',
        setInput: vi.fn(),
        textareaRef: { current: null },
        isStreaming: true,
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

      render(<InputArea />);

      const stopButton = screen.getByRole('button');
      expect(stopButton).toHaveTextContent(/stop/i);
    });
  });

  describe('Submit functionality', () => {
    it('calls onSend when submit button is clicked', () => {
      const onSend = vi.fn();
      vi.mocked(useChatInput).mockReturnValue({
        input: 'Test message',
        setInput: vi.fn(),
        textareaRef: { current: null },
        isStreaming: false,
        selectedModel: 'llama3',
        images: [],
        files: [],
        onSend,
        handleKeyDown: vi.fn(),
        handleTauriImageUpload: vi.fn(),
        handleTauriFileUpload: vi.fn(),
        removeImage: vi.fn(),
        removeFile: vi.fn(),
        t: (key: string) => key,
        currentConversationId: 'test-id',
        enterToSend: true,
      });

      render(<InputArea />);

      const sendButton = screen.getByRole('button', { name: /send/i });
      fireEvent.click(sendButton);

      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('prevents submission when input is empty', () => {
      const onSend = vi.fn();
      vi.mocked(useChatInput).mockReturnValue({
        input: '',
        setInput: vi.fn(),
        textareaRef: { current: null },
        isStreaming: false,
        selectedModel: 'llama3',
        images: [],
        files: [],
        onSend,
        handleKeyDown: vi.fn(),
        handleTauriImageUpload: vi.fn(),
        handleTauriFileUpload: vi.fn(),
        removeImage: vi.fn(),
        removeFile: vi.fn(),
        t: (key: string) => key,
        currentConversationId: 'test-id',
        enterToSend: true,
      });

      render(<InputArea />);

      const form = screen.getByRole('form');
      fireEvent.submit(form);

      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
