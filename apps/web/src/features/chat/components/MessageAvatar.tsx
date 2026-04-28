import React from 'react';
import { User, Bot } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface MessageAvatarProps {
  isUser: boolean;
}

export const MessageAvatar = React.memo(({ isUser }: MessageAvatarProps) => (
  <div className={cn(
    "w-8 h-8 shrink-0 flex items-center justify-center border",
    isUser 
      ? "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500" 
      : "bg-primary border-primary text-white"
  )}>
    {isUser ? <User size={16} /> : <Bot size={16} />}
  </div>
));

MessageAvatar.displayName = 'MessageAvatar';
