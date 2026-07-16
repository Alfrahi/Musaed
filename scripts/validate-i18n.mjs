/**
 * Validates i18n JSON files for:
 * 1. Key parity between en.json and ar.json (no missing keys in either).
 * 2. Key naming convention: `feature.subfeature.key` (dot-separated, lowercase).
 *
 * Usage: pnpm validate:i18n
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '..', 'apps', 'web', 'locales');

// ── Helpers ────────────────────────────────────────────────

/**
 * @param {string} lang
 * @returns {Record<string, unknown>}
 */
function loadDict(lang) {
  const filePath = resolve(LOCALES_DIR, `${lang}.json`);
  if (!existsSync(filePath)) {
    console.error(`❌ Missing locale file: ${filePath}`);
    process.exit(1);
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Recursively collect all leaf keys with dot-separated paths.
 * @param {unknown} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function getLeafKeys(obj, prefix = '') {
  if (Array.isArray(obj)) return [];
  if (typeof obj !== 'object' || obj === null) return [prefix];

  return Object.keys(obj).reduce((acc, key) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    return [...acc, ...getLeafKeys(value, fullKey)];
  }, []);
}

// ── Validation 1: Key parity ───────────────────────────────

function validateKeyParity() {
  const en = loadDict('en');
  const ar = loadDict('ar');

  const enKeys = getLeafKeys(en);
  const arKeys = getLeafKeys(ar);

  const missingInAr = enKeys.filter((k) => !arKeys.includes(k));
  const missingInEn = arKeys.filter((k) => !enKeys.includes(k));

  if (missingInAr.length === 0 && missingInEn.length === 0) {
    console.log('✅ Key parity: en.json and ar.json are synchronized.');
    return true;
  }

  console.error('❌ Key parity check failed:');
  for (const k of missingInAr) {
    console.error(`   Missing in ar.json: ${k}`);
  }
  for (const k of missingInEn) {
    console.error(`   Missing in en.json: ${k}`);
  }
  return false;
}

// ── Validation 2: Key naming convention ────────────────────

/**
 * Valid keys follow: feature[.subfeature...].leafKey
 * Each segment must start with lowercase or digit, contain alphanumeric chars
 * and underscores. camelCase segments are valid (e.g. "sidebar.noConversations").
 * Numeric-only segments are valid for lookup keys (e.g. "retention.30").
 */
const VALID_KEY_RE = /^[a-z0-9][a-zA-Z0-9_]*(\.[a-z0-9][a-zA-Z0-9_]*)*$/;

function validateKeyNaming() {
  const en = loadDict('en');
  const enKeys = getLeafKeys(en);

  const invalid = enKeys.filter((k) => !VALID_KEY_RE.test(k));

  if (invalid.length === 0) {
    console.log('✅ Key naming: all keys follow the `feature.subfeature.key` convention.');
    return true;
  }

  console.error('❌ Key naming convention violations:');
  for (const k of invalid) {
    console.error(
      `   Invalid key: "${k}" — must be lowercase dot-separated (e.g. "sidebar.noConversations").`,
    );
  }
  return false;
}

// ── Main ───────────────────────────────────────────────────

function main() {
  console.log('🌐 Validating i18n keys...\n');

  const parityOk = validateKeyParity();
  const namingOk = validateKeyNaming();

  console.log(''); // blank line before summary

  if (parityOk && namingOk) {
    console.log('🎉 All i18n validations passed.');
    process.exit(0);
  } else {
    console.error('💥 i18n validation failed. Fix the issues above before committing.');
    process.exit(1);
  }
}

main();