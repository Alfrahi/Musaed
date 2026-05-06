'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useCurrentConversationId,
  useGlobalSettings,
  useIsLiveStreaming,
  useSelectedModel,
} from '../../../store/hooks';
import { useChatActions } from './useChatActions';
import { useAttachmentManager } from './useAttachmentManager';
import { useTranslation } from '../../../lib/i18n';

export const useChatInput = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentConversationId = useCurrentConversationId();
  const isStreaming = useIsLiveStreaming(currentConversationId || '');
  const globalSettings = useGlobalSettings();
  const selectedModel = useSelectedModel();

  const { sendMessage } = useChatActions();
  const { t } = useTranslation(globalSettings.language);

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
  }, [currentConversationId, clearAttachments]);

  const onSend = useCallback(async () => {
    if (!input.trim() && images.length === 0 && files.length === 0) return;
    if (!currentConversationId) return;

    await sendMessage(input, images, files);
    setInput('');
    clearAttachments();
    textareaRef.current?.focus();
  }, [input, images, files, currentConversationId, sendMessage, clearAttachments]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isModEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
      const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey;

      if (globalSettings.enterToSend) {
        if (isPlainEnter) {
          e.preventDefault();
          onSend();
        }
      } else if (isModEnter) {
        e.preventDefault();
        onSend();
      }
    },
    [globalSettings.enterToSend, onSend]
  );

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
    enterToSend: globalSettings.enterToSend,
  };
};
