"use client";

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

const Skeleton = ({ className }: SkeletonProps) => {
  return (
    <div 
      className={cn(
        "animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded-md", 
        className
      )} 
    />
  );
};

export default Skeleton;