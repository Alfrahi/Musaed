"use client";

import { useState, useRef, useEffect } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useCurrentConversationId, useActiveStreams, useGlobalSettings, useSelectedModel } from '@/store/hooks';
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
  
  const currentConversationId = useCurrentConversationId();
  const activeStreams = useActiveStreams();
  const globalSettings = useGlobalSettings();
  const selectedModel = useSelectedModel();
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

  if (!currentConversationId) return null;
  const isStreaming = !!activeStreams[currentConversationId];

  const onSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && images.length === 0 && files.length === 0) return;
    await sendMessage(input, images, files);
    setInput('');
    clearAttachments();
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isModEnter = (e.metaKey || e.ctrlKey) && e.key === 'Enter';
    const isPlainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey;

    if (globalSettings.enterToSend) {
      if (isPlainEnter) {
        e.preventDefault();
        onSend();
      }
    } else {
      if (isModEnter) {
        e.preventDefault();
        onSend();
      }
    }
  };

  return (
    <div className="shrink-0 border-bs border-sidebar-border bg-background p-4">
      <div className="max-w-4xl ms-auto me-auto space-y-3">
        <AttachmentPreview 
          images={images} 
          files={files} 
          onRemoveImage={removeImage} 
          onRemoveFile={removeFile} 
        />
        
        <div className="border border-sidebar-border bg-zinc-50 dark:bg-zinc-950 p-1 rounded-lg focus-within:ring-1 focus-within:ring-blue-500/50 transition-all">
          <form onSubmit={onSend} className="flex flex-col">
            <input 
              type="file" 
              ref={imageInputRef} 
              className="hidden" 
              accept="image/*" 
              multiple 
              onChange={(e) => handleImageUpload(e.target.files)} 
            />
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              onChange={(e) => handleFileUpload(e.target.files)} 
            />

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.askAnything')}
              className="w-full bg-transparent border-none p-3 focus:ring-0 focus:outline-none outline-none resize-none min-h-[60px] max-h-48 text-[14px] placeholder:text-zinc-400 font-sans shadow-none"
              rows={1}
            />
            
            <div className="flex items-center justify-between ps-2 pe-2 pbe-2">
              <div className="flex items-center gap-1">
                <ModelSelector />
                <div className="w-[1px] h-3 bg-sidebar-border ms-2 me-2" />
                
                <button 
                  type="button" 
                  onClick={() => imageInputRef.current?.click()} 
                  className="p-2 rounded-lg text-zinc-400 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                  title={t('chat.attachImage')}
                >
                  <ImageIcon size={14} />
                </button>
                <button 
                  type="button" 
                  onClick={() => fileInputRef.current?.click()} 
                  className="p-2 rounded-lg text-zinc-400 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
                  title={t('common.files')}
                >
                  <Paperclip size={14} />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden sm:block text-[9px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
                  {isStreaming 
                    ? t('chat.shortcutStop')
                    : (globalSettings.enterToSend ? t('chat.shortcutSend') : t('chat.shortcutMultiLine'))
                  }
                </span>

                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => abortStreaming(currentConversationId)}
                    className="h-8 ps-4 pe-4 flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
                  >
                    <Square size={10} fill="currentColor" />
                    {t('common.done')}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!selectedModel || (!input.trim() && images.length === 0 && files.length === 0)}
                    className="h-8 ps-4 pe-4 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-20 active:scale-95 flex items-center gap-2 shadow-sm"
                  >
                    <Send size={10} className="mirror-rtl" />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default InputArea;