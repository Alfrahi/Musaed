"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useConversationStore, useSettingsStore, useModelStore } from '@/store';
import { useTranslation } from '@/lib/i18n';
import { useAutosizeTextArea } from '@/hooks/useAutosizeTextArea';
import { ModelSelector } from '@/features/library';
import { useChatActions } from '../hooks/useChatActions';
import { useConversationActions } from '../hooks/useConversationActions';
import { useAttachmentManager } from '../hooks/useAttachmentManager';
import AttachmentPreview from './AttachmentPreview';

const InputArea = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentConversationId, activeStreams } = useConversationStore();
  const { globalSettings } = useSettingsStore();
  const { selectedModel } = useModelStore();

  const { sendMessage } = useChatActions();
  const { abortStreaming } = useConversationActions();
  const { t } = useTranslation(globalSettings.language);

  const {
    images,
    files,
    handleImageUpload,
    handleFileUpload,
    removeImage,
    removeFile,
    clearAttachments
  } = useAttachmentManager();

  useAutosizeTextArea(textareaRef.current, input);

  useEffect(() => {
    clearAttachments();
    setInput('');
  }, [currentConversationId, clearAttachments]);

  // Hide the input area if no chat is selected
  if (!currentConversationId) {
    return null;
  }
  const isStreaming = !!activeStreams[currentConversationId];

  const openFilePicker = (input: HTMLInputElement | null) => {
    if (!input) return;
    // Allow re-selecting the same path: unchanged value skips `change` in browsers/WebViews.
    input.value = '';
    input.click();
  };

  const onSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && images.length === 0 && files.length === 0) return;

    await sendMessage(input, images, files);
    setInput('');
    clearAttachments();
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-4xl ms-auto me-auto w-full" role="complementary">
      <div className="flex items-center justify-between ps-6 pe-6 mbe-3 text-xs">
        <ModelSelector />
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-zinc-200 dark:border-zinc-800 shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.3)] overflow-hidden p-2 transition-shadow focus-within:shadow-[0_20px_60px_rgba(21,93,252,0.1)] dark:focus-within:shadow-[0_20px_60px_rgba(21,93,252,0.15)]">
        <AttachmentPreview
          images={images}
          files={files}
          onRemoveImage={removeImage}
          onRemoveFile={removeFile}
        />

        <form onSubmit={onSend} className="relative flex items-end gap-1 ps-2 pe-2 pbe-2">
          <div className="flex items-center gap-0.5 mbe-1">
            <input
              type="file"
              ref={imageInputRef}
              onChange={e => handleImageUpload(e.target.files)}
              className="hidden"
              accept="image/*"
              multiple
            />
            <button
              type="button"
              onClick={() => openFilePicker(imageInputRef.current)}
              className="p-2.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-2xl transition-all"
              aria-label={t('a11y.attachImage')}
            >
              <ImageIcon size={20} />
            </button>

            <input
              type="file"
              ref={fileInputRef}
              onChange={e => handleFileUpload(e.target.files)}
              className="hidden"
              multiple
            />
            <button
              type="button"
              onClick={() => openFilePicker(fileInputRef.current)}
              className="p-2.5 text-zinc-400 hover:text-primary hover:bg-primary/5 rounded-2xl transition-all"
              aria-label={t('common.files')}
            >
              <Paperclip size={20} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onSend())}
            placeholder={t('chat.askAnything')}
            aria-label={t('a11y.chatInput')}
            className="flex-1 bg-transparent border-none p-3 focus:ring-0 outline-none resize-none min-h-[44px] max-h-48 text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            rows={1}
          />

          <div className="mbe-1">
            {isStreaming ? (
              <button
                type="button"
                onClick={() => abortStreaming(currentConversationId)}
                className="w-10 h-10 flex items-center justify-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl shadow-lg hover:opacity-90 active:scale-95 transition-all"
                aria-label={t('a11y.stopResponse')}
              >
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!selectedModel || (!input.trim() && images.length === 0 && files.length === 0)}
                className="w-10 h-10 flex items-center justify-center bg-primary text-white rounded-2xl shadow-[0_4px_12px_rgba(21,93,252,0.3)] disabled:shadow-none disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all"
                aria-label={t('a11y.sendMessage')}
              >
                <Send size={18} className="mirror-rtl" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default InputArea;