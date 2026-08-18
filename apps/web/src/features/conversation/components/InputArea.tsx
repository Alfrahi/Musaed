'use client';

import { useCallback, useId } from 'react';
import { Send, Square, ImageIcon, Paperclip } from 'lucide-react';
import { useChatInput } from '@/features/conversation/hooks/useChatInput';
import { stopStream } from '@/store/coordination';
import { chatApi } from '@/lib/ipc';
import { useStreamingStore } from '@/store/streaming-store';
import { useDropZone } from '@/features/conversation/hooks/useDropZone';
import AttachmentPreview from './AttachmentPreview';
import { ModelSelector } from '@/features/library';
import { RagContextBadge } from '@/features/rag';
import { Button } from '@/components/ui/button';
import TokenContextBar from './TokenContextBar';
import type { FileAttachment } from '@/features/conversation/hooks/useAttachmentUtils';

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
  <Button variant="danger" size="icon" onClick={onClick} aria-label={label}>
    <Square size={10} fill="currentColor" />
  </Button>
);

/** Send message button. */
const SendButton = ({ disabled, ariaLabel }: { disabled: boolean; ariaLabel: string }) => (
  <Button type="submit" size="icon" variant="primary" disabled={disabled} aria-label={ariaLabel}>
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
    <span className="caption-xs hidden font-mono font-bold tracking-widest text-zinc-600 uppercase sm:block dark:text-zinc-400">
      {shortcutLabel}
    </span>
    {isStreaming ? (
      <AbortButton onClick={onAbort} label={abortLabel} />
    ) : (
      <SendButton disabled={disabled} ariaLabel={sendAriaLabel} />
    )}
  </div>
);

/** Form content for the input area (extracted to keep InputArea under lint limit). */
const InputAreaForm = ({
  textareaRef,
  textareaId,
  input,
  setInput,
  handleKeyDown,
  isDragOver,
  onSend,
  handleTauriImageUpload,
  handleTauriFileUpload,
  canSend,
  isStreaming,
  handleAbort,
  shortcutLabel,
  t,
  images,
  files,
  removeImage,
  removeFile,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  textareaId: string;
  input: string;
  setInput: (v: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isDragOver: boolean;
  onSend: () => void;
  handleTauriImageUpload: () => void;
  handleTauriFileUpload: () => void;
  canSend: boolean;
  isStreaming: boolean;
  handleAbort: () => void;
  shortcutLabel: string;
  t: (key: string) => string;
  images: string[];
  files: FileAttachment[];
  removeImage: (index: number) => void;
  removeFile: (index: number) => void;
}) => (
  <>
    <AttachmentPreview
      images={images}
      files={files}
      onRemoveImage={removeImage}
      onRemoveFile={removeFile}
    />

    <RagContextBadge />

    <div
      className={`border-sidebar-border shadow-raised duration-normal focus-within:shadow-raised rounded-md border bg-white p-1 ring-1 ring-zinc-200 transition-all focus-within:ring-blue-500/30 max-md:p-0.5 dark:bg-zinc-900 dark:ring-zinc-800 ${isDragOver ? 'ring-offset-background ring-2 ring-blue-500 ring-offset-2' : ''}`}
    >
      {isDragOver && (
        <div className="caption-md pbs-2 pointer-events-none px-3 text-center text-blue-600 dark:text-blue-400">
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
          id={textareaId}
          name="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.askAnything')}
          className="text-body max-h-48 min-h-[60px] w-full resize-none border-none bg-transparent p-3 font-sans shadow-none outline-none placeholder:text-zinc-400 focus-visible:ring-0 focus-visible:outline-none"
          rows={1}
        />
        <div className="pbe-2 flex items-center justify-between ps-2 pe-2">
          <ToolbarLeft
            onImage={handleTauriImageUpload}
            onFile={handleTauriFileUpload}
            imageLabel={t('chat.attachImage')}
            fileLabel={t('common.files')}
          />
          <TokenContextBar />
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
  </>
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

  const handleAbort = useCallback(() => {
    if (currentConversationId) {
      const requestId = useStreamingStore.getState().activeStreams[currentConversationId];
      if (requestId) chatApi.abort(requestId);
      // Pass the requestId so stopStream bails out if a
      // new stream has replaced the old one before this call runs
      // (abort race).
      stopStream(currentConversationId, 'abort', requestId);
    }
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

  const canSend = !!selectedModel && (input.trim() !== '' || images.length > 0 || files.length > 0);
  const textareaId = useId();

  return (
    <div className="border-bs border-sidebar-border bg-background shrink-0 p-4">
      <div className="ms-auto me-auto max-w-4xl space-y-3">
        <InputAreaForm
          textareaRef={textareaRef}
          textareaId={textareaId}
          input={input}
          setInput={setInput}
          handleKeyDown={handleKeyDown}
          isDragOver={isDragOver}
          onSend={onSend}
          handleTauriImageUpload={handleTauriImageUpload}
          handleTauriFileUpload={handleTauriFileUpload}
          canSend={canSend}
          isStreaming={isStreaming}
          handleAbort={handleAbort}
          shortcutLabel={shortcutLabel}
          t={t}
          images={images}
          files={files}
          removeImage={removeImage}
          removeFile={removeFile}
        />
      </div>
    </div>
  );
};

export default InputArea;
