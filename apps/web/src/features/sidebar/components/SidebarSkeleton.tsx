'use client';

import { Skeleton } from '@/components/ui';

const SidebarSkeleton = () => {
  return (
    <div className="flex h-full flex-col space-y-4 p-4">
      {/* Header Placeholder */}
      <Skeleton className="h-10 w-full rounded-xl" />

      {/* Search Placeholder */}
      <Skeleton className="h-8 w-full rounded-lg" />

      {/* List Item Placeholders */}
      <div className="pbs-4 space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2 ps-3 pe-3">
            <Skeleton className="h-4 w-4 rounded-md" />
            <Skeleton className="h-4 flex-1 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default SidebarSkeleton;
