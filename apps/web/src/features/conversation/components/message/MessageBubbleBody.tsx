'use client';

import React from 'react';
import type { Message } from '@musaed/contracts';
import type { SourceReference, TranslateFn } from './types';
import MessageContent from '../MessageContent';
import { MessageAvatar } from '../MessageAvatar';
import { MessageHeader } from './MessageHeader';
import { RagSourceReferences } from './RagSourceReferences';
import { MessageImages } from './MessageImages';
import { InlineEditor } from './InlineEditor';
import { MessageFooter } from './MessageFooter';
import { StoppedStatusLine } from './StoppedStatusLine';

export interface MessageBubbleBodyProps {
  isUser: boolean;
  isStopped: boolean;
  isEditing: boolean;
  message: Message;
  labels: {
    user: string;
    assistant: string;
    copy: string;
    tokens: string;
    outputTokens: string;
  };
  sourceReferences: SourceReference[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenSource: (source: SourceReference) => void;
  onImageClick: (img: string) => void;
  tps: number;
  formatNumber: (num: number, options?: Intl.NumberFormatOptions) => string;
  copied: boolean;
  handleCopy: (overrideText?: string) => void;
  onRegenerate?: (msgId: string) => void;
  onContinue?: (msgId: string) => void;
  onStartEdit?: () => void;
  onSaveEdit: (newContent: string) => void;
  onCancelEdit: () => void;
  handleDelete: (() => void) | undefined;
  t: TranslateFn;
}

/** Inner layout: avatar + content + footer. Extracted to keep
 *  MessageBubble under the max-lines-per-function lint gate. */
export const MessageBubbleBody = ({
  isUser,
  isStopped,
  isEditing,
  message,
  labels,
  sourceReferences,
  isExpanded,
  onToggleExpand,
  onOpenSource,
  onImageClick,
  tps,
  formatNumber,
  copied,
  handleCopy,
  onRegenerate,
  onContinue,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  handleDelete,
  t,
}: MessageBubbleBodyProps) => (
  <div className="group ms-auto me-auto flex max-w-4xl gap-6 py-6 ps-5 pe-5 max-md:gap-4 max-md:ps-3 max-md:pe-3">
    <MessageAvatar isUser={isUser} />
    <div className="min-w-0 flex-1 space-y-4">
      <MessageHeader isUser={isUser} message={message} labels={labels} />
      {message.images && message.images.length > 0 && (
        <MessageImages images={message.images} onImageClick={onImageClick} t={t} />
      )}
      {isEditing ? (
        <InlineEditor
          initialContent={message.content}
          onSave={onSaveEdit}
          onCancel={onCancelEdit}
          t={t}
        />
      ) : (
        <div className="text-foreground selection:bg-primary/20 text-body leading-relaxed antialiased">
          <MessageContent message={message} isUser={isUser} />
        </div>
      )}
      {sourceReferences.length > 0 && !isEditing && (
        <RagSourceReferences
          sources={sourceReferences}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          onOpenSource={onOpenSource}
          t={t}
        />
      )}
      <StoppedStatusLine isStopped={isStopped} msgId={message.id} onContinue={onContinue} t={t} />
      <MessageFooter
        isUser={isUser}
        isStopped={isStopped}
        msgId={message.id}
        labels={labels}
        message={message}
        tps={tps}
        formatNumber={formatNumber}
        copied={copied}
        handleCopy={handleCopy}
        onRegenerate={onRegenerate}
        onContinue={onContinue}
        onStartEdit={onStartEdit}
        handleDelete={handleDelete}
        t={t}
      />
    </div>
  </div>
);

export const MemoizedMessageBubbleBody = React.memo(MessageBubbleBody);
