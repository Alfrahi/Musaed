"use client";

import Skeleton from '../../layout/components/Skeleton';

const ChatWindowSkeleton = () => {
  return (
    <div className="flex-1 space-y-8 p-6 max-w-4xl ms-auto me-auto w-full">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`flex gap-5 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
          <Skeleton className="w-10 h-10 rounded-2xl shrink-0" />
          <div className={`space-y-2 flex-1 ${i % 2 === 0 ? 'flex flex-col items-end' : ''}`}>
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