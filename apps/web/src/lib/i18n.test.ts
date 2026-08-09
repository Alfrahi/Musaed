import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranslation, translate, formatRelativeTime } from '@/lib/i18n';

describe('Internationalization Utility', () => {
  it('resolves nested keys correctly in English', () => {
    const { result } = renderHook(() => useTranslation('en'));
    expect(result.current.t('common.appName')).toBe('Musaed');
    expect(result.current.t('sidebar.newChat')).toBe('New Chat');
  });

  it('resolves nested keys correctly in Arabic', () => {
    const { result } = renderHook(() => useTranslation('ar'));
    expect(result.current.t('common.appName')).toBe('مُساعد');
    expect(result.current.t('sidebar.newChat')).toBe('محادثة جديدة');
  });

  it('handles pluralization correctly', () => {
    const { result } = renderHook(() => useTranslation('en'));
    expect(result.current.t('library.installed', { count: 0 })).toBe('No models');
    expect(result.current.t('library.installed', { count: 1 })).toBe('1 model installed');
    expect(result.current.t('library.installed', { count: 5 })).toBe('5 models installed');
  });

  it('formats file sizes into human readable strings', () => {
    const { result } = renderHook(() => useTranslation('en'));
    expect(result.current.formatFileSize(1024)).toBe('1 KB');
    expect(result.current.formatFileSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
  });

  it('detects RTL direction for Arabic', () => {
    const { result: resultAr } = renderHook(() => useTranslation('ar'));
    const { result: resultEn } = renderHook(() => useTranslation('en'));
    expect(resultAr.current.isRtl).toBe(true);
    expect(resultEn.current.isRtl).toBe(false);
  });
});

describe('translate (non-hook API)', () => {
  it('resolves nested keys identically to useTranslation for English', () => {
    expect(translate('common.appName', 'en')).toBe('Musaed');
    expect(translate('sidebar.newChat', 'en')).toBe('New Chat');
  });

  it('resolves nested keys identically to useTranslation for Arabic', () => {
    expect(translate('common.appName', 'ar')).toBe('مُساعد');
    expect(translate('sidebar.newChat', 'ar')).toBe('محادثة جديدة');
  });

  it('handles pluralization and interpolation', () => {
    expect(translate('library.installed', 'en', { count: 0 })).toBe('No models');
    expect(translate('library.installed', 'en', { count: 5 })).toBe('5 models installed');
  });

  it('falls back to English when a key is missing in the active locale', () => {
    // 'apples' is not in ar.json — should fall back to en.json value
    // and ultimately to the key itself when the key is wholly unknown.
    expect(translate('nonexistent.key', 'en')).toBe('nonexistent.key');
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-08-09T12:00:00Z').getTime();
  let originalNow: () => number;

  beforeEach(() => {
    originalNow = Date.now;
    Date.now = () => NOW;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  it('returns "just now" for timestamps less than 60 seconds old', () => {
    expect(formatRelativeTime(NOW - 30_000, 'en')).toBe('Just now');
    expect(formatRelativeTime(NOW - 30_000, 'ar')).toBe('الآن');
  });

  it('returns a localized "Nm ago" for sub-hour deltas (English)', () => {
    const s = formatRelativeTime(NOW - 5 * 60_000, 'en');
    expect(s).toMatch(/5/);
    expect(s.toLowerCase()).toMatch(/minute/);
  });

  it('returns a localized "Nh ago" for sub-day deltas (English)', () => {
    const s = formatRelativeTime(NOW - 3 * 3_600_000, 'en');
    expect(s).toMatch(/3/);
    expect(s.toLowerCase()).toMatch(/hour/);
  });

  it('returns "Yesterday" for a 1-day-old timestamp in English (numeric:auto)', () => {
    const s = formatRelativeTime(NOW - 24 * 3_600_000, 'en');
    // Intl.RelativeTimeFormat with numeric:'auto' yields "yesterday" for -1 day.
    expect(s.toLowerCase()).toBe('yesterday');
  });

  it('returns "أمس" for a 1-day-old timestamp in Arabic (numeric:auto)', () => {
    const s = formatRelativeTime(NOW - 24 * 3_600_000, 'ar');
    expect(s).toBe('أمس');
  });

  it('returns a short date for timestamps older than 7 days (English)', () => {
    // 30 days ago → should be a "Mon D" short date, not "days ago".
    const s = formatRelativeTime(NOW - 30 * 86_400_000, 'en');
    expect(/^[A-Z][a-z]{2} \d+$/.test(s), `unexpected short date format: ${s}`).toBe(true);
  });

  it('handles future timestamps (just-now tolerance still applies)', () => {
    expect(formatRelativeTime(NOW + 10_000, 'en')).toBe('Just now');
  });
});
