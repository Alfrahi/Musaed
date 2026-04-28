"use client";

import React, { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
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
  maxWidth = "max-w-md",
  className,
  zIndex = "z-50"
}: ModalLayoutProps) => {
  if (!isOpen) return null;

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div className={cn("fixed inset-0 flex items-center justify-center p-6 bg-background/80 backdrop-blur-sm", zIndex)}>
        <motion.div 
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "bg-white dark:bg-zinc-950 w-full border border-sidebar-border shadow-pro overflow-hidden flex flex-col",
            maxWidth,
            className
          )}
        >
          {children}
        </motion.div>
      </div>
    </FocusTrap>
  );
};

export default ModalLayout;
