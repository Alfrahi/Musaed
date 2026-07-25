'use client';

import React, { type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ModalLayoutProps {
  isOpen: boolean;
  /**
   * Called when the user requests to dismiss the modal — Escape keydown or
   * backdrop pointerdown. Required: every dialog must have a dismiss affordance
   * (STANDARDS.md §13). The text on the visible dismissal button is owned by
   * the consumer and must be localized by the caller.
   */
  onClose: () => void;
  /**
   * id of the element that labels this dialog (aria-labelledby). When
   * omitted, an internally-generated id is rendered but no labelling
   * element — consumers that want the labelled-by relationship MUST render a
   * visible heading with `id={titleId}`.
   */
  titleId?: string;
  /**
   * Optional id of an element that describes the dialog
   * (aria-describedby). Use to associate instructions/selectors with the
   * dialog surface.
   */
  describedById?: string;
  children: ReactNode;
  maxWidth?: string;
  className?: string;
  zIndex?: string;
}

const ModalLayout = ({
  isOpen,
  onClose,
  titleId: titleIdProp,
  describedById,
  children,
  maxWidth = 'max-w-md',
  className,
  zIndex = 'z-50',
}: ModalLayoutProps) => {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Capture the previously-focused element on open, restore it on close.
  // Mirrors the WAI-ARIA dialog focus-management contract.
  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;

    return () => {
      const prev = previousFocusRef.current;
      if (prev && document.contains(prev)) {
        prev.focus({ preventScroll: false });
      }
    };
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Escape keydown listener — bound on document so it fires regardless of
  // where focus settled inside the trap.
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Backdrop pointerdown closes; clicking the panel itself does not. We use
  // pointerdown (not click) so the trap can settle focus before a synthetic
  // click could fire on a child.
  const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <FocusTrap
      focusTrapOptions={{
        // Escape is handled at the document level for symmetry with the
        // backdrop; FocusTrap's own `escapeDeactivates` would also work but we
        // route through `onClose` so the host's state transitions always win.
        escapeDeactivates: false,
        // When the trap deactivates (modal unmounts), don't let focus-trap
        // restore the previously focused element on its own — we own that in
        // the effect above for close focus restoration, with a stricter
        // "is element still in the DOM?" check.
        returnFocusOnDeactivate: false,
        // Fallback focus target: the dialog panel. Ensures a tabbable child
        // is not required for the trap to mount.
        fallbackFocus: () => panelRef.current ?? document.body,
        allowOutsideClick: true,
      }}
    >
      <div
        className={cn(
          'bg-background/80 fixed inset-0 flex items-center justify-center p-6 backdrop-blur-sm',
          zIndex
        )}
        onPointerDown={handleBackdropPointerDown}
      >
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={describedById}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            'border-sidebar-border shadow-pro flex w-full flex-col overflow-hidden border bg-white outline-none dark:bg-zinc-950',
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
