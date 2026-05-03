'use client';

import { Toaster } from 'react-hot-toast';

const ToastProvider = () => {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        className:
          'dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-medium shadow-xl',
        duration: 4000,
      }}
    />
  );
};

export default ToastProvider;
