'use client';

import { Suspense } from 'react';
import { HomeClient } from '@/features/layout';

const Home = () => {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      }
    >
      <HomeClient />
    </Suspense>
  );
};

export default Home;
