import en from '../locales/en.json';
import ar from '../locales/ar.json';

type Dictionary = { [key: string]: string | Dictionary | string[] };
const enAny = en as Dictionary;
const arAny = ar as Dictionary;

function getKeys(obj: Dictionary, prefix = ''): string[] {
  return Object.keys(obj).reduce((res: string[], el) => {
    const value = obj[el];
    if (Array.isArray(value)) {
      return res;
    } else if (typeof value === 'object' && value !== null) {
      return [...res, ...getKeys(value, prefix + el + '.')];
    }
    return [...res, prefix + el];
  }, []);
}

const enKeys = new Set(getKeys(en));
const arKeys = new Set(getKeys(ar));

// Add missing keys with empty string values
for (const key of [...enKeys].filter((k) => !arKeys.has(k))) {
  arAny[key] = '';
}
for (const key of [...arKeys].filter((k) => !enKeys.has(k))) {
  enAny[key] = '';
}

import { writeFileSync } from 'fs';
import { logger } from '@/lib/logger';
import path from 'path';
const enPath = path.resolve(__dirname, '../locales/en.json');
const arPath = path.resolve(__dirname, '../locales/ar.json');
writeFileSync(enPath, JSON.stringify(en, null, 2));
writeFileSync(arPath, JSON.stringify(ar, null, 2));
logger.info('✅ i18n keys synchronized between en.json and ar.json');
