"use client";

import { Suspense } from 'react';
import { ModelLibrary } from '@/features/library';

const LibraryLoading = () => {
  return (
    <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
};

const LibraryPage = () => {
  return (
    <Suspense fallback={<LibraryLoading />}>
      <ModelLibrary
        isOpen={true}
        onClose={() => window.history.back()}
      />
    </Suspense>
  );
};

export default LibraryPage;
