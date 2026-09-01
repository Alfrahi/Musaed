import { type Language } from '@musaed/contracts';
import { useCallback, useMemo } from 'react';
import IntlMessageFormat from 'intl-messageformat';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import { config } from './config';

const translations = { en, ar };

type NestedKeyOf<T> = T extends object
  ? {
      [K in keyof T]: `${K & string}${T[K] extends object ? `.${NestedKeyOf<T[K]>}` : ''}`;
    }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<typeof en>;

/**
 * Resolver for the active UI language, used by module-scoped code that cannot
 * call the {@link useTranslation} hook (notably `lib/ipc.ts` and other lib-layer
 * error paths). Defaults to `'en'` until the app boot orchestrator wires it to
 * the settings store via {@link setActiveLanguageResolver}. Keeping this indirection
 * in `lib/i18n.ts` (rather than having `lib/ipc.ts` reach into the settings store
 * directly) avoids a static import cycle: `lib/tauri-storage.ts` already imports
 * from `lib/ipc.ts`, so a top-level `ipc → store` edge would close a cycle banned
 * by dep-cruiser.
 */
let activeLanguageResolver: () => Language = () => 'en';

/**
 * Register a resolver returning the active UI language. Called once during app
 * boot (see `useAppInitialization`) and kept live via a Zustand `subscribe(...)`
 * so the resolver tracks settings changes for the lifetime of the session.
 */
export const setActiveLanguageResolver = (resolver: () => Language): void => {
  activeLanguageResolver = resolver;
};

/**
 * Returns the active UI language via the registered resolver (defaults to `'en'`
 * before the resolver is wired). Safe to call from anywhere, including
 * module-scoped code outside React render.
 */
export const getActiveLanguage = (): Language => activeLanguageResolver();

const missingKeyWarned = new Set<string>();
const warnMissingKey = (key: string, lang: Language): void => {
  if (config.isProd) return;
  const id = `${lang}:${key}`;
  if (missingKeyWarned.has(id)) return;
  missingKeyWarned.add(id);
  console.warn(
    `[i18n] Missing translation key "${key}" for "${lang}" and fallback "en"; rendering the key itself.`
  );
};

/**
 * Resolve a translation key for the given language.
 *
 * Pure-function form of {@link useTranslation}, for module-scoped code that
 * cannot call a hook (e.g. `lib/ipc.ts`, event handlers in `useTauriEvents.ts`
 * that are declared at module scope). Resolves keys through the same dictionary
 * lookup + `IntlMessageFormat` interpolation as the hook's `t`.
 *
 * @param key - Dot-separated translation key (e.g. `error.securityBlock`).
 * @param lang - Active language used for dictionary lookup and locale formatting.
 * @param values - Optional interpolation values passed to `IntlMessageFormat`.
 * @returns The resolved localized string, or the key itself as a fallback.
 */
export const translate = (
  key: TranslationKey | string,
  lang: Language,
  values?: Record<string, string | number | boolean>
): string => {
  const keys = key.split('.');
  const dict = (translations[lang] || translations.en) as Record<string, unknown>;
  const defaultDict = translations.en as Record<string, unknown>;

  const resolve = (obj: Record<string, unknown>, k: string[]): string | undefined => {
    const val = k.reduce(
      (acc: unknown, part: string) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      obj
    );
    return typeof val === 'string' ? val : undefined;
  };

  const value = resolve(dict, keys) || resolve(defaultDict, keys);
  if (!value) {
    warnMissingKey(key, lang);
    return key;
  }

  if (!values) return value;

  const activeLocale = lang === 'ar' ? 'ar-YE' : 'en-US';
  try {
    return new IntlMessageFormat(value, activeLocale).format(values) as string;
  } catch {
    return value;
  }
};

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

const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats a timestamp as a locale-aware relative-time string for sidebar rows
 * and similar dense metadata surfaces ("just now", "3m ago", "5h ago",
 * "Yesterday", "3 days ago", "Mar 5"). Uses {@link Intl.RelativeTimeFormat}
 * with `numeric: 'auto'` so unit phrases ("yesterday" vs. "1 day ago") and
 * Arabic forms are localized by the runtime, not by app locale files.
 *
 * Thresholds match the sidebar grouping
 * ({@link useSidebarGrouping}): < 1 min → "just now"; < 1 hr → minutes;
 * < 24 hr → hours; < 7 days → days (`auto` yields "Yesterday" / "أمس" at -1);
 * ≥ 7 days → a short date via the same calendar convention as
 * {@link useTranslation}`.formatDate` (`ar-YE-u-ca-islamic` for Arabic).
 *
 * @param timestamp Epoch-ms timestamp (e.g. `ConversationMetadata.updatedAt`).
 * @param lang Active UI language — selects locale and dictionary for "just now".
 */
export const formatRelativeTime = (timestamp: number, lang: Language): string => {
  const now = Date.now();
  const diffMs = timestamp - now;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (Math.abs(diffSec) < 60) return translate('common.justNow', lang);

  const locale = lang === 'ar' ? 'ar-YE' : 'en-US';
  const rtfKey = `${locale}:auto`;
  let rtf = relativeTimeFormatters.get(rtfKey);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeTimeFormatters.set(rtfKey, rtf);
  }

  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour');
  if (Math.abs(diffDay) < 7) return rtf.format(diffDay, 'day');

  const shortDateLocale = lang === 'ar' ? 'ar-YE-u-ca-islamic' : 'en-US';
  let shortDate = shortDateFormatters.get(shortDateLocale);
  if (!shortDate) {
    shortDate = new Intl.DateTimeFormat(shortDateLocale, { month: 'short', day: 'numeric' });
    shortDateFormatters.set(shortDateLocale, shortDate);
  }
  return shortDate.format(timestamp);
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

      if (!value) {
        warnMissingKey(key, lang);
        return key;
      }

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
