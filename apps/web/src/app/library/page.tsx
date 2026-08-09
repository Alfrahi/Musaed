'use client';

import { Suspense } from 'react';
import { ModelLibrary } from '@/features/library';

const LibraryLoading = () => {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
      <div className="border-bs-transparent h-8 w-8 animate-spin rounded-full border-4 border-blue-600" />
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
