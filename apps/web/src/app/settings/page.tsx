'use client';

import { Suspense } from 'react';
import { SettingsModal } from '@/features/settings';

const SettingsLoading = () => {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-zinc-950">
      <div className="border-bs-transparent h-8 w-8 animate-spin rounded-full border-4 border-blue-600" />
    </div>
  );
};

const SettingsPage = () => {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsModal isOpen={true} onClose={() => window.history.back()} />
    </Suspense>
  );
};

export default SettingsPage;
