"use client";

import { Skeleton } from '../../layout';

const SidebarSkeleton = () => {
  return (
    <div className="flex flex-col h-full space-y-4 p-4">
      {/* Header Placeholder */}
      <Skeleton className="h-10 w-full rounded-xl" />
      
      {/* Search Placeholder */}
      <Skeleton className="h-8 w-full rounded-lg" />
      
      {/* List Item Placeholders */}
      <div className="space-y-3 pbs-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3 ps-3 pe-3 py-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 flex-1 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default SidebarSkeleton;