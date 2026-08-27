'use client';

import { useEffect } from 'react';
import { useIsHydrated } from '@/store/hooks';
import { registerHydrationCoordination } from '@/store/coordination';

/**
 * HydrationProvider coordinates store rehydration across ALL pages.
 * Unlike HomeClient (which only mounts on the homepage), this provider
 * lives in the root layout and ensures hydration completes on every route.
 */
const HydrationProvider = ({ children }: { children: React.ReactNode }) => {
  const isHydrated = useIsHydrated();

  useEffect(() => {
    const unsubscribe = registerHydrationCoordination();
    return unsubscribe;
  }, []);

  // Expose hydration state for testing
  useEffect(() => {
    if (isHydrated) {
      (window as unknown as { __MUSAED_HYDRATED__?: boolean }).__MUSAED_HYDRATED__ = true;
    }
  }, [isHydrated]);

  return <>{children}</>;
};

export default HydrationProvider;
