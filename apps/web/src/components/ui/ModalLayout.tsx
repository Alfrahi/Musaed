'use client';

import React, { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ModalLayoutProps {
  isOpen: boolean;
  children: ReactNode;
  maxWidth?: string;
  className?: string;
  zIndex?: string;
  onClose?: () => void;
}

const ModalLayout = ({
  isOpen,
  children,
  maxWidth = 'max-w-md',
  className,
  zIndex = 'z-50',
}: ModalLayoutProps) => {
  if (!isOpen) return null;

  return (
    <div
      className={cn(
        'bg-background/80 fixed inset-0 flex items-center justify-center p-6 backdrop-blur-sm',
        zIndex
      )}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          'border-sidebar-border shadow-pro flex w-full flex-col overflow-hidden border bg-white dark:bg-zinc-950',
          maxWidth,
          className
        )}
      >
        {children}
      </motion.div>
    </div>
  );
};

export default ModalLayout;
