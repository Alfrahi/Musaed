'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { HomeClient } from '@/features/layout';

const Home = () => {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
          <Loader2 className="text-primary h-8 w-8 animate-spin" aria-hidden="true" />
        </div>
      }
    >
      <HomeClient />
    </Suspense>
  );
};

export default Home;
