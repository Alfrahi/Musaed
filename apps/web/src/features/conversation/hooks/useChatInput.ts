'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversationStore } from '@/store/conversation-store';
import { useSettingsStore } from '@/store/settings-store';
import { useModelStore } from '@/store/model-store';
import { useStreamingStore } from '@/store/streaming-store';
import { useChatSend } from './useChatSend';
import { useAttachmentManager } from './useAttachmentManager';
import { useTranslation } from '@/lib/i18n';
import { subscribeEditPrompt } from '../utils/edit-prompt-signal';

export const useChatInput = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const { sendMessage } = useChatSend();
  const {
    images,
    files,
    handleTauriImageUpload,
    handleTauriFileUpload,
    handleDroppedFiles,
    removeImage,
    removeFile,
    clearAttachments,
  } = useAttachmentManager();

  useEffect(() => {
    clearAttachments();
    setInput('');
  }, [clearAttachments]);

  const onSend = useCallback(async () => {
    if (!input.trim() && images.length === 0 && files.length === 0) return;
    const currentConversationId = useConversationStore.getState().currentConversationId;
    if (!currentConversationId) return;

    await sendMessage(input, images, files);
    setInput('');
    clearAttachments();
    textareaRef.current?.focus();
  }, [input, images, files, sendMessage, clearAttachments]);

  // Escape is intentionally NOT handled here. The Escape-to-stop contract is
  // owned exclusively by useGlobalShortcuts (audit F6) so the global handler
  // and a textarea-local handler never both fire stopStreamForConversation. Enter/Cmd-Enter
  // remain the only keys this handler owns.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isModEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey;
      const enterToSend = useSettingsStore.getState().globalSettings.enterToSend;

      if (enterToSend) {
        if (isPlainEnter) {
          e.preventDefault();
          onSend();
        }
      } else if (isModEnter) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend]
  );

  // Subscribe to "Edit prompt" / "Edit" signals from MessageBubble hover
  // actions (Prompt 14). One-shot: populates the textarea then focuses it.
  useEffect(() => {
    return subscribeEditPrompt((prompt) => {
      setInput(prompt);
      textareaRef.current?.focus();
    });
  }, []);

  const currentConversationId = useConversationStore.getState().currentConversationId;
  const isStreaming = currentConversationId
    ? useStreamingStore.getState().activeStreams[currentConversationId] != null
    : false;
  const selectedModel = useModelStore.getState().selectedModel;
  const enterToSend = useSettingsStore.getState().globalSettings.enterToSend;

  return {
    input,
    setInput,
    textareaRef,
    isStreaming,
    selectedModel,
    images,
    files,
    onSend,
    handleKeyDown,
    handleTauriImageUpload,
    handleTauriFileUpload,
    handleDroppedFiles,
    removeImage,
    removeFile,
    t,
    currentConversationId,
    enterToSend,
  };
};
