'use client';

import { Toaster, resolveValue, type Toast } from 'react-hot-toast';
import { AlertCircle, Check } from 'lucide-react';

const BASE_CLASS =
  'bg-white dark:bg-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-800 rounded-md text-body font-medium shadow-pro';

const toastIcon = (type: Toast['type']) => {
  if (type === 'success') return <Check size={16} className="text-green-500" />;
  if (type === 'error') return <AlertCircle size={16} className="text-destructive" />;
  return null;
};

const toastAccent = (type: Toast['type']) => {
  if (type === 'success') return 'border-s-2 border-s-green-500';
  if (type === 'error') return 'border-s-2 border-s-destructive';
  return '';
};

const ToastProvider = () => {
  return (
    <Toaster position="top-center" toastOptions={{ duration: 4000 }}>
      {(toast) => {
        const icon = toastIcon(toast.type);
        const accent = toastAccent(toast.type);
        return (
          <div
            className={`${BASE_CLASS} ${accent}`.trim()}
            role={toast.ariaProps.role}
            aria-live={toast.ariaProps['aria-live']}
          >
            <div className="flex items-center gap-2 px-4 py-3">
              {icon}
              <span>{resolveValue(toast.message, toast)}</span>
            </div>
          </div>
        );
      }}
    </Toaster>
  );
};

export default ToastProvider;
