"use client";

import React, { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';

interface ModalLayoutProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
  className?: string;
  zIndex?: string;
}

const ModalLayout = ({ 
  isOpen, 
  onClose, 
  children, 
  maxWidth = "max-w-md",
  className,
  zIndex = "z-50"
}: ModalLayoutProps) => {
  if (!isOpen) return null;

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          "fixed inset-0 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md",
          zIndex
        )}
        role="dialog"
        aria-modal="true"
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className={cn(
            "bg-white dark:bg-zinc-900 w-full rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col",
            maxWidth,
            className
          )}
        >
          {children}
        </motion.div>
      </motion.div>
    </FocusTrap>
  );
};

export default ModalLayout;