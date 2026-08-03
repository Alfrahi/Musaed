import React from 'react';
import { User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageAvatarProps {
  isUser: boolean;
}

export const MessageAvatar = React.memo(({ isUser }: MessageAvatarProps) => (
  <div
    className={cn(
      'flex h-8 w-8 shrink-0 items-center justify-center border',
      isUser
        ? 'border-blue-500 bg-white text-blue-500 dark:border-blue-400 dark:bg-zinc-800 dark:text-blue-400'
        : 'bg-primary border-primary text-white'
    )}
  >
    {isUser ? <User size={16} /> : <Bot size={16} />}
  </div>
));

MessageAvatar.displayName = 'MessageAvatar';
