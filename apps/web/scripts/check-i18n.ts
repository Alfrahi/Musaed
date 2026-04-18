import en from '../locales/en.json';
import ar from '../locales/ar.json';

type Dictionary = { [key: string]: string | Dictionary | string[] };

function getKeys(obj: Dictionary, prefix = ''): string[] {
  return Object.keys(obj).reduce((res: string[], el) => {
    const value = obj[el];
    if (Array.isArray(value)) {
      return res;
    } else if (typeof value === 'object' && value !== null) {
      return [...res, ...getKeys(value as Dictionary, prefix + el + '.')];
    }
    return [...res, prefix + el];
  }, []);
}

const enKeys = getKeys(en as Dictionary);
const arKeys = getKeys(ar as Dictionary);

const missingInAr = enKeys.filter(k => !arKeys.includes(k));
const missingInEn = arKeys.filter(k => !enKeys.includes(k));

if (missingInAr.length > 0 || missingInEn.length > 0) {
  console.error('❌ I18n Sync Check Failed:');
  missingInAr.forEach(k => console.error(` - Missing in ar.json: ${k}`));
  missingInEn.forEach(k => console.error(` - Missing in en.json: ${k}`));
  process.exit(1);
} else {
  console.log('✅ I18n Sync Check Passed: English and Arabic keys are synchronized.');
  process.exit(0);
}