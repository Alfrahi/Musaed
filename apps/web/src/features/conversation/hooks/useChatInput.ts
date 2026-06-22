'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversationStore } from '@/features/conversation/store/conversation-store';
import { useSettingsStore } from '@/features/settings/store/settings-store';
import { useModelStore } from '@/features/settings/store/model-store';
import { useStreamingStore } from '@/features/conversation/store/streaming-store';
import { useChatActions } from './useChatActions';
import { useAttachmentManager } from './useAttachmentManager';
import { useTranslation } from '@/lib/i18n';

export const useChatInput = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const language = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(language);
  const { sendMessage } = useChatActions();
  const {
    images,
    files,
    handleTauriImageUpload,
    handleTauriFileUpload,
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
    removeImage,
    removeFile,
    t,
    currentConversationId,
    enterToSend,
  };
};
