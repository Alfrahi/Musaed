import { describe, it, expect } from 'vitest';
import { useTranslation } from './i18n';

describe('Internationalization Utility', () => {
  it('resolves nested keys correctly in English', () => {
    const { t } = useTranslation('en');
    expect(t('common.appName')).toBe('Musaed');
    expect(t('sidebar.newChat')).toBe('New Chat');
  });

  it('resolves nested keys correctly in Arabic', () => {
    const { t } = useTranslation('ar');
    expect(t('common.appName')).toBe('مُساعد');
    expect(t('sidebar.newChat')).toBe('محادثة جديدة');
  });

  it('handles pluralization correctly', () => {
    const { t } = useTranslation('en');
    expect(t('library.installed', { count: 0 })).toBe('No models');
    expect(t('library.installed', { count: 1 })).toBe('1 model installed');
    expect(t('library.installed', { count: 5 })).toBe('5 models installed');
  });

  it('formats file sizes into human readable strings', () => {
    const { formatFileSize } = useTranslation('en');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
  });

  it('detects RTL direction for Arabic', () => {
    const { isRtl } = useTranslation('ar');
    const { isRtl: isLtr } = useTranslation('en');
    expect(isRtl).toBe(true);
    expect(isLtr).toBe(false);
  });
});
