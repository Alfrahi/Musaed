'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { ModelLibrary } from '@/features/library';

const LibraryLoading = () => {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
      <Loader2 className="text-primary h-8 w-8 animate-spin" aria-hidden="true" />
    </div>
  );
};

const LibraryPage = () => {
  return (
    <Suspense fallback={<LibraryLoading />}>
      <ModelLibrary isOpen={true} onClose={() => window.history.back()} />
    </Suspense>
  );
};

export default LibraryPage;
