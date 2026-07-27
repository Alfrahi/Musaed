'use client';

import { useCallback, useEffect } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useChatInput } from '@/features/conversation/hooks/useChatInput';
import { abortStreaming } from '@/features/conversation/hooks/useConversationActions';
import { useDropZone } from '@/features/conversation/hooks/useDropZone';
import AttachmentPreview from './AttachmentPreview';
import { ModelSelector } from '@/features/library';
// RagContextBadge is imported from the components directory to avoid feature-to-feature imports
import { RagContextBadge } from '@/components/ui/RagContextBadge';
import { Button } from '@/components/ui/button';
import { useChatInputStore } from '@/store/chat-input-store';

/**
 * Watches for "Edit prompt" / "Edit" signals from MessageBubble hover actions
 * (Prompt 14). One-shot: populates the textarea then clears the signal.
 */
function useEditPromptWatcher(
  setInput: (value: string) => void,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
) {
  const editPrompt = useChatInputStore((s) => s.editPrompt);
  const clearEditPrompt = useChatInputStore((s) => s.setEditPrompt);
  useEffect(() => {
    if (editPrompt !== null) {
      setInput(editPrompt);
      clearEditPrompt(null);
      textareaRef.current?.focus();
    }
  }, [editPrompt, setInput, clearEditPrompt, textareaRef]);
}

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
    <Button
      variant="ghost"
      size="icon"
      onClick={onImage}
      className="p-2 text-zinc-400"
      title={imageLabel}
      aria-label={imageLabel}
    >
      <ImageIcon size={14} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      onClick={onFile}
      className="p-2 text-zinc-400"
      title={fileLabel}
      aria-label={fileLabel}
    >
      <Paperclip size={14} />
    </Button>
  </>
);

/** Stop streaming button. */
const AbortButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <Button variant="secondary" size="sm" onClick={onClick}>
    <Square size={10} fill="currentColor" />
    {label}
  </Button>
);

/** Send message button. */
const SendButton = ({ disabled, ariaLabel }: { disabled: boolean; ariaLabel: string }) => (
  <Button type="submit" size="sm" variant="primary" disabled={disabled} aria-label={ariaLabel}>
    <Send size={10} className="mirror-rtl" />
  </Button>
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
  sendAriaLabel,
}: {
  isStreaming: boolean;
  disabled: boolean;
  onAbort: () => void;
  shortcutLabel: string;
  abortLabel: string;
  sendAriaLabel: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="caption-xs hidden font-mono font-bold tracking-widest text-zinc-400 uppercase sm:block">
      {shortcutLabel}
    </span>
    {isStreaming ? (
      <AbortButton onClick={onAbort} label={abortLabel} />
    ) : (
      <SendButton disabled={disabled} ariaLabel={sendAriaLabel} />
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
    handleDroppedFiles,
    removeImage,
    removeFile,
    t,
    currentConversationId,
    enterToSend,
  } = useChatInput();

  useEditPromptWatcher(setInput, textareaRef);

  const handleAbort = useCallback(() => {
    if (currentConversationId) abortStreaming(currentConversationId);
  }, [currentConversationId]);

  const { isDragOver } = useDropZone({
    onDrop: useCallback(
      (dropped: { imagePaths: string[]; filePaths: string[] }) => {
        handleDroppedFiles(dropped.imagePaths, dropped.filePaths);
      },
      [handleDroppedFiles]
    ),
  });

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

        <div
          className={`border-sidebar-border rounded-lg border bg-zinc-50 p-1 transition-all focus-within:ring-1 focus-within:ring-blue-500/50 dark:bg-zinc-950 ${isDragOver ? 'ring-offset-background ring-2 ring-blue-500 ring-offset-2' : ''}`}
        >
          {isDragOver && (
            <div className="caption-md pointer-events-none px-3 pt-2 text-center text-blue-600 dark:text-blue-400">
              {t('a11y.dropFiles')}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
            className="flex flex-col"
            data-testid="input-area-form"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.askAnything')}
              className="max-h-48 min-h-[60px] w-full resize-none border-none bg-transparent p-3 font-sans text-[14px] shadow-none outline-none placeholder:text-zinc-400 focus-visible:ring-0 focus-visible:outline-none"
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
                abortLabel={t('chat.stop')}
                sendAriaLabel={t('a11y.sendMessage')}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default InputArea;
