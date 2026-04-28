"use client";

import { Suspense } from 'react';
import { HomeClient } from '@/features/layout';

const Home = () => {
  return (
    <Suspense fallback=
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    >
      <HomeClient />
    </Suspense>
  );
};

export default Home;
