'use client';

import { Skeleton } from '@/components/ui';

const ChatWindowSkeleton = () => {
  return (
    <div
      className="ms-auto me-auto w-full max-w-4xl flex-1 space-y-8 p-6"
      data-testid="skeleton-loader"
    >
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex gap-5 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <div className={`flex-1 space-y-2 ${i % 2 === 0 ? 'flex flex-col items-end' : ''}`}>
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-3 w-32 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
};

export default ChatWindowSkeleton;
