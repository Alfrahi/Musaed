'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ScrollShadow — renders a subtle gradient at the bottom of a scrollable
 * container when content overflows and the user is not at the bottom.
 *
 * Two usage modes:
 *
 * 1. **Controlled** — pass `visible` directly (for Virtuoso consumers that
 *    already track `atBottomStateChange`). The gradient fades in/out based
 *    on the boolean.
 *
 * 2. **Auto-detect** — omit `visible` and wrap a scrollable element. An
 *    `IntersectionObserver` watches a sentinel `<div>` pinned to the bottom
 *    of the scroll container; the shadow appears when the sentinel is not
 *    intersecting (i.e. content overflows past the viewport).
 *
 * The gradient is 24px tall: transparent → rgba(0,0,0,0.05) in light mode,
 * transparent → rgba(255,255,255,0.03) in dark mode.
 */
interface ScrollShadowProps {
  /** Explicitly control visibility (e.g. from Virtuoso `atBottomStateChange`). */
  visible?: boolean;
  /** When provided, auto-detect mode is used and children are rendered inside. */
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

const SHADOW_CLASS =
  'pointer-events-none absolute inset-x-0 bottom-0 h-6 z-10 bg-gradient-to-b from-transparent to-black/[0.05] dark:to-white/[0.03] transition-opacity duration-fast';

/**
 * Auto-detect mode: wraps children in a relative container, observes a
 * sentinel at the bottom, and fades the gradient in/out.
 */
const AutoScrollShadow = ({
  children,
  className,
  contentClassName,
}: {
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sentinel = container.querySelector('[data-scroll-shadow-sentinel]');
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), {
      root: container,
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className={contentClassName}>{children}</div>
      <div aria-hidden="true" className={cn(SHADOW_CLASS, visible ? 'opacity-100' : 'opacity-0')} />
      <div data-scroll-shadow-sentinel className="h-px w-full shrink-0" aria-hidden="true" />
    </div>
  );
};

export const ScrollShadow = ({
  visible,
  children,
  className,
  contentClassName,
}: ScrollShadowProps) => {
  // Auto-detect mode (children provided) — wrap + observe.
  if (children !== undefined) {
    return (
      <AutoScrollShadow className={className} contentClassName={contentClassName}>
        {children}
      </AutoScrollShadow>
    );
  }

  // Controlled mode (no children) — render the gradient overlay only.
  return (
    <div aria-hidden="true" className={cn(SHADOW_CLASS, visible ? 'opacity-100' : 'opacity-0')} />
  );
};

export default ScrollShadow;
