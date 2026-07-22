'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/store/settings-store';
import { useIsHydrated } from '@/store/hooks';
import { useNativeUX } from '@/hooks/useNativeUX';

const DirectionProvider = ({ children }: { children: React.ReactNode }) => {
  const globalSettings = useSettingsStore((s) => s.globalSettings);
  const isHydrated = useIsHydrated();

  useNativeUX();

  // Layout synchronization
  useEffect(() => {
    if (!isHydrated) return;

    const dir = globalSettings.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = globalSettings.language;
    document.body.dir = dir;
  }, [globalSettings.language, isHydrated]);

  // Theme synchronization with manual override support
  useEffect(() => {
    if (!isHydrated) return;

    const applyTheme = (theme: 'light' | 'dark') => {
      const root = document.documentElement;
      if (theme === 'dark') {
        root.classList.add('dark');
        root.style.colorScheme = 'dark';
      } else {
        root.classList.remove('dark');
        root.style.colorScheme = 'light';
      }
    };

    if (globalSettings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');

      applyTheme(mediaQuery.matches ? 'dark' : 'light');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    applyTheme(globalSettings.theme);
    return undefined;
  }, [globalSettings.theme, isHydrated]);

  return <>{children}</>;
};

export default DirectionProvider;
