"use client";

import { Suspense } from 'react';
import { SettingsModal } from '@/features/settings';

const SettingsLoading = () => {
  return (
    <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-950">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
};

const SettingsPage = () => {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsModal
        isOpen={true}
        onClose={() => window.history.back()}
      />
    </Suspense>
  );
};

export default SettingsPage;
