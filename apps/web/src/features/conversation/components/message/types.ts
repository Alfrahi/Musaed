import type { Message } from '@musaed/contracts';

/** Message bubble's public render contract (used by the thin root). */
export interface MessageBubbleProps {
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
    outputTokens: string;
  };
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  /** Called when the user selects "Regenerate" from the context menu.
   *  Receives the assistant message id so the caller can keep a stable
   *  callback reference (React.memo defeat). */
  onRegenerate?: (msgId: string) => void;
  /** Called when the user clicks "Continue" on a stopped message. */
  onContinue?: (msgId: string) => void;
  /** Called when the user saves an inline edit on their own message.
   *  Receives the message id and the new content. The parent is
   *  responsible for updating the store and re-sending. */
  onEditMessage?: (msgId: string, newContent: string) => void;
  /** Called when the user confirms deletion of a message.
   *  Receives the message id. The parent is responsible for
   *  removing the message from the store and backend. */
  onDeleteMessage?: (msgId: string) => void;
}

/** RAG source reference attached to an assistant message. */
export interface SourceReference {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
}

/** Shared translator function shape used by message sub-components. */
export type TranslateFn = (
  key: string,
  values?: Record<string, string | number | boolean>
) => string;
