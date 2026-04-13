import en from '../locales/en.json';
import ar from '../locales/ar.json';

function getKeys(obj: any, prefix = ''): string[] {
  return Object.keys(obj).reduce((res: string[], el) => {
    if (Array.isArray(obj[el])) {
      return res;
    } else if (typeof obj[el] === 'object' && obj[el] !== null) {
      return [...res, ...getKeys(obj[el], prefix + el + '.')];
    }
    return [...res, prefix + el];
  }, []);
}

const enKeys = getKeys(en);
const arKeys = getKeys(ar);

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