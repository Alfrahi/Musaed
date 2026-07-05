'use client';

import { useCallback } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useChatInput } from '@/features/conversation/hooks/useChatInput';
import { abortStreaming } from '@/features/conversation/hooks/useConversationActions';
import AttachmentPreview from './AttachmentPreview';
import { ModelSelector } from '@/features/library';
import { RagContextBadge } from '@/features/rag';

/** Attach action buttons (image + file upload). */
const AttachButtons = ({
  onImage,
  onFile,
  imageLabel,
  fileLabel,
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
      className="hover:text-foreground rounded-lg p-2 text-zinc-400 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title={imageLabel}
    >
      <ImageIcon size={14} />
    </button>
    <button
      type="button"
      onClick={onFile}
      className="hover:text-foreground rounded-lg p-2 text-zinc-400 transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
    className="flex h-8 items-center gap-2 rounded-lg bg-zinc-900 ps-4 pe-4 text-[10px] font-bold tracking-widest text-white uppercase transition-all active:scale-95 dark:bg-zinc-100 dark:text-zinc-900"
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
    className="flex h-8 items-center gap-2 rounded-lg bg-blue-600 ps-4 pe-4 text-[10px] font-bold tracking-widest text-white uppercase shadow-sm transition-all active:scale-95 disabled:opacity-20"
  >
    <Send size={10} className="mirror-rtl" />
  </button>
);

/** Left side of toolbar: model selector + attach buttons. */
const ToolbarLeft = ({
  onImage,
  onFile,
  imageLabel,
  fileLabel,
}: {
  onImage: () => void;
  onFile: () => void;
  imageLabel: string;
  fileLabel: string;
}) => (
  <div className="flex items-center gap-1">
    <ModelSelector />
    <div className="bg-sidebar-border ms-2 me-2 h-3 w-[1px]" />
    <AttachButtons
      onImage={onImage}
      onFile={onFile}
      imageLabel={imageLabel}
      fileLabel={fileLabel}
    />
  </div>
);

/** Right side of toolbar: shortcut hint + action button. */
const ToolbarRight = ({
  isStreaming,
  disabled,
  onAbort,
  shortcutLabel,
  abortLabel,
}: {
  isStreaming: boolean;
  disabled: boolean;
  onAbort: () => void;
  shortcutLabel: string;
  abortLabel: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="hidden font-mono text-[9px] font-bold tracking-widest text-zinc-400 uppercase sm:block">
      {shortcutLabel}
    </span>
    {isStreaming ? (
      <AbortButton onClick={onAbort} label={abortLabel} />
    ) : (
      <SendButton disabled={disabled} />
    )}
  </div>
);

/**
 * Chat input area - pure Tauri desktop implementation.
 */
export const InputArea = () => {
  const {
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
  } = useChatInput();

  const handleAbort = useCallback(() => {
    if (currentConversationId) abortStreaming(currentConversationId);
  }, [currentConversationId]);

  const shortcutLabel = isStreaming
    ? t('chat.shortcutStop')
    : enterToSend
      ? t('chat.shortcutSend')
      : t('chat.shortcutMultiLine');

  const canSend = selectedModel && (input.trim() || images.length > 0 || files.length > 0);

  return (
    <div className="border-bs border-sidebar-border bg-background shrink-0 p-4">
      <div className="ms-auto me-auto max-w-4xl space-y-3">
        <AttachmentPreview
          images={images}
          files={files}
          onRemoveImage={removeImage}
          onRemoveFile={removeFile}
        />

        <RagContextBadge />

        <div className="border-sidebar-border rounded-lg border bg-zinc-50 p-1 transition-all focus-within:ring-1 focus-within:ring-blue-500/50 dark:bg-zinc-950">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
            className="flex flex-col"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.askAnything')}
              className="max-h-48 min-h-[60px] w-full resize-none border-none bg-transparent p-3 font-sans text-[14px] shadow-none outline-none placeholder:text-zinc-400 focus:ring-0 focus:outline-none"
              rows={1}
            />
            <div className="pbe-2 flex items-center justify-between ps-2 pe-2">
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
