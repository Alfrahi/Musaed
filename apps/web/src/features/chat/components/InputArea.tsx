"use client";

import { useCallback } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useChatInput } from '../hooks/useChatInput';
import { abortStreaming } from '../hooks/useConversationActions';
import AttachmentPreview from './AttachmentPreview';
import { ModelSelector } from '@/features/library';

/** Attach action buttons (image + file upload). */
const AttachButtons = ({
  onImage, onFile, imageLabel, fileLabel,
}: {
  onImage: () => void;
  onFile: () => void;
  imageLabel: string;
  fileLabel: string;
}) => (
  <>
    <button
      type="button"
      onClick={onImage}
      className="p-2 rounded-lg text-zinc-400 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
      title={imageLabel}
    >
      <ImageIcon size={14} />
    </button>
    <button
      type="button"
      onClick={onFile}
      className="p-2 rounded-lg text-zinc-400 hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
      title={fileLabel}
    >
      <Paperclip size={14} />
    </button>
  </>
);

/** Stop streaming button. */
const AbortButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    className="h-8 ps-4 pe-4 flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95"
  >
    <Square size={10} fill="currentColor" />
    {label}
  </button>
);

/** Send message button. */
const SendButton = ({ disabled }: { disabled: boolean }) => (
  <button
    type="submit"
    disabled={disabled}
    className="h-8 ps-4 pe-4 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-20 active:scale-95 flex items-center gap-2 shadow-sm"
  >
    <Send size={10} className="mirror-rtl" />
  </button>
);

/** Left side of toolbar: model selector + attach buttons. */
const ToolbarLeft = ({
  onImage, onFile, imageLabel, fileLabel,
}: {
  onImage: () => void;
  onFile: () => void;
  imageLabel: string;
  fileLabel: string;
}) => (
  <div className="flex items-center gap-1">
    <ModelSelector />
    <div className="w-[1px] h-3 bg-sidebar-border ms-2 me-2" />
    <AttachButtons onImage={onImage} onFile={onFile} imageLabel={imageLabel} fileLabel={fileLabel} />
  </div>
);

/** Right side of toolbar: shortcut hint + action button. */
const ToolbarRight = ({
  isStreaming, disabled, onAbort, shortcutLabel, abortLabel,
}: {
  isStreaming: boolean;
  disabled: boolean;
  onAbort: () => void;
  shortcutLabel: string;
  abortLabel: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="hidden sm:block text-[9px] font-bold text-zinc-400 uppercase tracking-widest font-mono">
      {shortcutLabel}
    </span>
    {isStreaming
      ? <AbortButton onClick={onAbort} label={abortLabel} />
      : <SendButton disabled={disabled} />}
  </div>
);

/**
 * Chat input area - pure Tauri desktop implementation.
 */
export const InputArea = () => {
  const {
    input, setInput, textareaRef, isStreaming, selectedModel,
    images, files, onSend, handleKeyDown,
    handleTauriImageUpload, handleTauriFileUpload, removeImage, removeFile,
    t, currentConversationId, enterToSend,
  } = useChatInput();

  const handleAbort = useCallback(() => {
    if (currentConversationId) abortStreaming(currentConversationId);
  }, [currentConversationId]);

  const shortcutLabel = isStreaming
    ? t('chat.shortcutStop')
    : (enterToSend ? t('chat.shortcutSend') : t('chat.shortcutMultiLine'));

  const canSend = selectedModel && (input.trim() || images.length > 0 || files.length > 0);

  return (
    <div className="shrink-0 border-bs border-sidebar-border bg-background p-4">
      <div className="max-w-4xl ms-auto me-auto space-y-3">
        <AttachmentPreview images={images} files={files} onRemoveImage={removeImage} onRemoveFile={removeFile} />

        <div className="border border-sidebar-border bg-zinc-50 dark:bg-zinc-950 p-1 rounded-lg focus-within:ring-1 focus-within:ring-blue-500/50 transition-all">
          <form onSubmit={(e) => { e.preventDefault(); onSend(); }} className="flex flex-col">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.askAnything')}
              className="w-full bg-transparent border-none p-3 focus:ring-0 focus:outline-none outline-none resize-none min-h-[60px] max-h-48 text-[14px] placeholder:text-zinc-400 font-sans shadow-none"
              rows={1}
            />
            <div className="flex items-center justify-between ps-2 pe-2 pbe-2">
              <ToolbarLeft
                onImage={handleTauriImageUpload}
                onFile={handleTauriFileUpload}
                imageLabel={t('chat.attachImage')}
                fileLabel={t('common.files')}
              />
              <ToolbarRight
                isStreaming={isStreaming}
                disabled={!canSend}
                onAbort={handleAbort}
                shortcutLabel={shortcutLabel}
                abortLabel={t('common.done')}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default InputArea;
