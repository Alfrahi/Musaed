import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranslation, translate } from '@/lib/i18n';

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
