import { Language } from '@musaed/contracts';
import IntlMessageFormat from 'intl-messageformat';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

const translations = { en, ar };

type NestedKeyOf<T> = T extends object 
  ? { [K in keyof T]: `${K & string}${T[K] extends object ? `.${NestedKeyOf<T[K]>}` : ''}` }[keyof T] 
  : never;

export type TranslationKey = NestedKeyOf<typeof en>;

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const messageFormatters = new Map<string, IntlMessageFormat>();

/**
 * Detects the system language based on the browser/webview environment.
 * Used primarily during the first-time initialization.
 */
export const getSystemLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';
  return navigator.language.startsWith('ar') ? 'ar' : 'en';
};

/**
 * Returns the layout direction (RTL/LTR) for a given language.
 */
export const getDirection = (lang: Language): 'rtl' | 'ltr' => {
  return lang === 'ar' ? 'rtl' : 'ltr';
};

export const useTranslation = (lang: Language) => {
  const activeLocale = lang === 'ar' ? 'ar-YE' : 'en-US';

  const t = (key: TranslationKey | string, values?: Record<string, any>) => {
    const keys = key.split('.');
    const dict = translations[lang] || translations.en;
    
    const value = keys.reduce((acc, k) => (acc && typeof acc === 'object' ? (acc as any)[k] : undefined), dict) 
      || keys.reduce((acc, k) => (acc && typeof acc === 'object' ? (acc as any)[k] : undefined), translations.en);
    
    if (typeof value !== 'string') return key;

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
  };

  const isRtl = lang === 'ar';

  const formatDate = (date: number | Date, options?: Intl.DateTimeFormatOptions) => {
    const locale = lang === 'ar' ? 'ar-YE-u-ca-islamic' : 'en-US';
    const cacheKey = `${locale}:${JSON.stringify(options)}`;
    
    let formatter = dateTimeFormatters.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, options);
      dateTimeFormatters.set(cacheKey, formatter);
    }
    return formatter.format(date);
  };

  const formatNumber = (num: number, options?: Intl.NumberFormatOptions) => {
    const cacheKey = `${activeLocale}:${JSON.stringify(options)}`;
    
    let formatter = numberFormatters.get(cacheKey);
    if (!formatter) {
      formatter = new Intl.NumberFormat(activeLocale, options);
      numberFormatters.set(cacheKey, formatter);
    }
    return formatter.format(num);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return `0 ${t('common.units.b')}`;
    const k = 1024;
    const units = ['b', 'kb', 'mb', 'gb', 'tb'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    return `${formatNumber(value)} ${t(`common.units.${units[i]}`)}`;
  };

  return { t, isRtl, formatDate, formatNumber, formatFileSize };
};