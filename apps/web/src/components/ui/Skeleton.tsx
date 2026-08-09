'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

const Skeleton = ({ className }: SkeletonProps) => {
  return <div className={cn('shimmer rounded-sm bg-zinc-200 dark:bg-zinc-800', className)} />;
};

export default Skeleton;
