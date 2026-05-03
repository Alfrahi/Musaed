import { Language } from '@musaed/contracts';
import { useCallback, useMemo } from 'react';
import IntlMessageFormat from 'intl-messageformat';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

const translations = { en, ar };

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: `${K & string}${T[K] extends object ? `.${NestedKeyOf<T[K]>}` : ''}`;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<typeof en>;

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const messageFormatters = new Map<string, IntlMessageFormat>();

/**
 * Detects the system language based on the browser/webview environment.
 * Used primarily during the first-time initialization.
 *
 * @returns {Language} The detected system language ('en' or 'ar').
 */
export const getSystemLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';
  return navigator.language.startsWith('ar') ? 'ar' : 'en';
};

/**
 * Hook for using translation and formatting utilities.
 *
 * @param {Language} lang - The active application language.
 * @returns Object containing translation and formatting functions.
 */
export const useTranslation = (lang: Language) => {
  const activeLocale = lang === 'ar' ? 'ar-YE' : 'en-US';

  const t = useCallback(
    (key: TranslationKey | string, values?: Record<string, string | number | boolean>) => {
      const keys = key.split('.');
      const dict = (translations[lang] || translations.en) as Record<string, unknown>;
      const defaultDict = translations.en as Record<string, unknown>;

      const resolve = (obj: Record<string, unknown>, k: string[]): string | undefined => {
        const val = k.reduce(
          (acc: unknown, part) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
          obj
        );
        return typeof val === 'string' ? val : undefined;
      };

      const value = resolve(dict, keys) || resolve(defaultDict, keys);

      if (!value) return key;

      if (!values) return value;

      try {
        const cacheKey = `${activeLocale}:${value}`;
        let formatter = messageFormatters.get(cacheKey);
        if (!formatter) {
          formatter = new IntlMessageFormat(value, activeLocale);
          messageFormatters.set(cacheKey, formatter);
        }
        return formatter.format(values) as string;
      } catch {
        return value;
      }
    },
    [lang, activeLocale]
  );

  const isRtl = lang === 'ar';

  const formatDate = useCallback(
    (date: number | Date, options?: Intl.DateTimeFormatOptions) => {
      const locale = lang === 'ar' ? 'ar-YE-u-ca-islamic' : 'en-US';
      const cacheKey = `${locale}:${JSON.stringify(options)}`;

      let formatter = dateTimeFormatters.get(cacheKey);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        dateTimeFormatters.set(cacheKey, formatter);
      }
      return formatter.format(date);
    },
    [lang]
  );

  const formatNumber = useCallback(
    (num: number, options?: Intl.NumberFormatOptions) => {
      const cacheKey = `${activeLocale}:${JSON.stringify(options)}`;

      let formatter = numberFormatters.get(cacheKey);
      if (!formatter) {
        formatter = new Intl.NumberFormat(activeLocale, options);
        numberFormatters.set(cacheKey, formatter);
      }
      return formatter.format(num);
    },
    [activeLocale]
  );

  const formatFileSize = useCallback(
    (bytes: number) => {
      if (bytes === 0) return `0 ${t('common.units.b')}`;
      const k = 1024;
      const units = ['b', 'kb', 'mb', 'gb', 'tb'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
      return `${formatNumber(value)} ${t(`common.units.${units[i]}`)}`;
    },
    [t, formatNumber]
  );

  return useMemo(
    () => ({ t, isRtl, formatDate, formatNumber, formatFileSize }),
    [t, isRtl, formatDate, formatNumber, formatFileSize]
  );
};
