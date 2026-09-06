'use client';

import type { Message } from '@musaed/contracts';

interface MessageHeaderProps {
  isUser: boolean;
  message: Message;
  labels: { user: string; assistant: string };
}

export const MessageHeader = ({ isUser, message, labels }: MessageHeaderProps) => (
  <div className="flex items-center">
    <span className="caption-md font-bold text-zinc-400 uppercase">
      {isUser ? labels.user : labels.assistant}
      {!isUser && message.model && <span className="ms-3 text-zinc-500">{message.model}</span>}
    </span>
  </div>
);
