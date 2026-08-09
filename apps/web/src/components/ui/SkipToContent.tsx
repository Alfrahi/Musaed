'use client';

import { useSettingsStore } from '@/store/settings-store';
import { useTranslation } from '@/lib/i18n';

/**
 * WCAG 2.4.1 Bypass Blocks — a skip-to-content link that is visually hidden
 * until focused, then appears as a styled button at the top-start of the
 * viewport. Must be the first focusable element in the DOM.
 */
const SkipToContent = () => {
  const lang = useSettingsStore((s) => s.globalSettings.language);
  const { t } = useTranslation(lang);

  return (
    <a
      href="#main"
      className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:border focus:px-3 focus:py-2"
    >
      {t('a11y.skipToContent')}
    </a>
  );
};

export default SkipToContent;
