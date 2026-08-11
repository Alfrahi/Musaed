'use client';

import React, { forwardRef, type ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/*
 * Modal padding convention (apps-wide):
 *   - Small modals (max-w-md/max-w-sm/max-w-lg): content body p-6.
 *   - Page-like modals (max-w-3xl and wider, e.g. SettingsModal, LogViewer,
 *     ModelLibrary): content body p-8.
 *   - Headers: px-4 py-3 border-be, gap-3, icon container h-9 w-9 rounded-md.
 *   - Footers: px-4 py-3 border-bs, gap-2, flex justify-end (or justify-between
 *     when a status label sits opposite the action buttons).
 */

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

const ModalSurface = forwardRef<
  HTMLDivElement,
  {
    shouldReduceMotion: boolean;
    panelRef: React.RefObject<HTMLDivElement | null>;
    titleId: string;
    describedById?: string;
    maxWidth: string;
    className?: string;
    zIndex: string;
    onBackdropPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    children: ReactNode;
  }
>(
  (
    {
      shouldReduceMotion,
      panelRef,
      titleId,
      describedById,
      maxWidth,
      className,
      zIndex,
      onBackdropPointerDown,
      children,
    },
    forwardedRef
  ) => {
    const backdropClassName = cn(
      'bg-background/80 fixed inset-0 flex items-center justify-center p-6 backdrop-blur-sm',
      zIndex
    );
    const panelClassName = cn(
      'border-sidebar-border shadow-pro flex w-full flex-col overflow-hidden border bg-background outline-none',
      maxWidth,
      className
    );

    if (shouldReduceMotion) {
      return (
        <div ref={forwardedRef} className={backdropClassName} onPointerDown={onBackdropPointerDown}>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={describedById}
            tabIndex={-1}
            className={panelClassName}
          >
            {children}
          </div>
        </div>
      );
    }

    return (
      <motion.div
        ref={forwardedRef}
        className={backdropClassName}
        onPointerDown={onBackdropPointerDown}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
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
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className={panelClassName}
        >
          {children}
        </motion.div>
      </motion.div>
    );
  }
);

ModalSurface.displayName = 'ModalSurface';

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
  const shouldReduceMotion = useReducedMotion() ?? false;

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
      <ModalSurface
        shouldReduceMotion={shouldReduceMotion}
        panelRef={panelRef}
        titleId={titleId}
        describedById={describedById}
        maxWidth={maxWidth}
        className={className}
        zIndex={zIndex}
        onBackdropPointerDown={handleBackdropPointerDown}
      >
        {children}
      </ModalSurface>
    </FocusTrap>
  );
};

export default ModalLayout;
