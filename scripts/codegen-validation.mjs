#!/usr/bin/env node

/**
 * Codegen: validation-limits.ts → generated_validation.rs
 *
 * Reads the TypeScript source of truth (`packages/contracts/src/validation-limits.ts`),
 * evaluates every exported constant, and writes a Rust file containing the same
 * constants so that frontend (Zod) and backend (Rust) validation never drift apart.
 *
 * Usage:
 *   pnpm codegen:validation          # write generated file
 *   pnpm codegen:validation --check   # diff only, exit 1 on mismatch
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const TS_SRC = resolve(ROOT, 'packages/contracts/src/validation-limits.ts');
const RUST_DST = resolve(ROOT, 'src-tauri/src/generated_validation.rs');

// ---------------------------------------------------------------------------
// 1. Parse the TypeScript file
// ---------------------------------------------------------------------------

function parseTsFile(tsContent) {
  const constants = {};
  const comments = {};

  const lines = tsContent.split('\n');
  let pendingComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Collect JSDoc comments
    if (line.startsWith('/**')) {
      const parts = [];
      // Could be single-line: /** text */ or multi-line
      let j = i;
      let closed = false;
      while (j < lines.length) {
        let cl = lines[j].trim();
        if (j === i && cl.startsWith('/**')) cl = cl.slice(3);
        if (cl.endsWith('*/')) {
          cl = cl.slice(0, -2);
          closed = true;
        }
        if (cl.startsWith('*')) cl = cl.slice(1);
        cl = cl.trim();
        if (cl) parts.push(cl);
        if (closed) break;
        j++;
      }
      pendingComment = parts.join(' ');
      continue;
    }

    // Match: export const NAME = VALUE;
    const constMatch = line.match(
      /^export\s+const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)(?:\s+as\s+const)?\s*;/
    );
    if (constMatch) {
      const name = constMatch[1];
      let rawValue = constMatch[2].trim();

      if (pendingComment) {
        comments[name] = pendingComment;
        pendingComment = '';
      }

      // Parse value
      if (rawValue.startsWith('[')) {
        constants[name] = parseArrayValue(rawValue);
      } else if (rawValue.startsWith("'") || rawValue.startsWith('"')) {
        constants[name] = rawValue.slice(1, -1);
      } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
        constants[name] = parseFloat(rawValue);
      } else {
        // Numeric expression — evaluate safely
        try {
          // eslint-disable-next-line no-eval
          constants[name] = eval(rawValue);
        } catch {
          console.error(`Failed to evaluate constant ${name} = ${rawValue}`);
          process.exit(1);
        }
      }
    } else if (!line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*')) {
      // Not a comment or constant — reset pending comment only if it's non-doc content
      // (blank lines between doc and const are fine)
      if (line !== '' && !line.startsWith('export')) {
        pendingComment = '';
      }
    }
  }

  return { constants, comments };
}

function parseArrayValue(raw) {
  const inner = raw.slice(1, -1).trim();
  if (inner.length === 0) return [];

  const items = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (inString) {
      if (ch === stringChar) {
        inString = false;
      }
      current += ch;
    } else if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ']') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items.map((item) => {
    if (item.startsWith("'") || item.startsWith('"')) {
      return item.slice(1, -1);
    }
    const num = Number(item);
    if (!isNaN(num)) return num;
    try {
      // eslint-disable-next-line no-eval
      return eval(item);
    } catch {
      return item;
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Categorise constants
// ---------------------------------------------------------------------------

const CHAT_CONSTS = [
  'MAX_MODEL_NAME_LEN',
  'MAX_REQUEST_ID_LEN',
  'MAX_MESSAGE_CONTENT_LEN',
  'MAX_MESSAGES_COUNT',
  'MAX_IMAGES_PER_MESSAGE',
  'MAX_IMAGE_B64_LEN',
  'MAX_LOG_ENTRY_LEN',
  'MAX_LOG_CLEAR_TOKEN_LEN',
  'MAX_TITLE_INPUT_LEN',
  'MAX_ROLE_LEN',
  // Structured logging
  'MAX_FEATURE_NAME_LEN',
  'MAX_ACTION_NAME_LEN',
  'MAX_TRACE_MESSAGE_LEN',
  'MAX_TRACE_CONTEXT_FIELDS',
  'MAX_TRACE_CONTEXT_VALUE_LEN',
  'TEMPERATURE_RANGE',
  'TOP_K_RANGE',
  'TOP_P_RANGE',
  'NUM_PREDICT_RANGE',
  'NUM_CTX_RANGE',
  'MAX_STOP_SEQUENCES',
  'MAX_STOP_SEQUENCE_LEN',
];

const ALLOWED_VALUES = ['VALID_ROLES', 'VALID_LANGUAGES'];

const RAG_CONSTS = [
  'MAX_PROJECT_NAME_LEN',
  'MAX_PROJECT_PATH_LEN',
  'MAX_IGNORE_PATTERNS',
  'MAX_IGNORE_PATTERN_LEN',
  'MAX_SEARCH_QUERY_LEN',
  'MAX_TOP_K',
  'MIN_TOP_K',
  'MAX_THRESHOLD',
  'MIN_THRESHOLD',
  'MAX_FILE_CHUNKS_QUERY',
  'MAX_FILE_PATH_LEN',
  'MAX_RAG_CONTEXT_CHARS',
];

// Constants that are f32 in Rust (floats, not integers)
const F32_CONSTS = new Set(['MAX_THRESHOLD', 'MIN_THRESHOLD']);

// Ranges that are (f32, f32) in Rust
const F32_RANGES = new Set(['TEMPERATURE_RANGE', 'TOP_P_RANGE']);

// ---------------------------------------------------------------------------
// 3. Generate Rust code
// ---------------------------------------------------------------------------

function formatRustValue(name, value) {
  if (Array.isArray(value)) {
    if (typeof value[0] === 'string') {
      const items = value.map((s) => `"${s}"`).join(', ');
      return `&[${items}]`;
    }
    // Numeric range
    if (F32_RANGES.has(name)) {
      const a = value[0];
      const b = value[1];
      return `(${a}${a % 1 === 0 ? '.0' : ''}, ${b}${b % 1 === 0 ? '.0' : ''})`;
    }
    // Integer range
    return `(${value[0]}, ${value[1]})`;
  }
  if (typeof value === 'string') return `"${value}"`;
  if (F32_CONSTS.has(name)) {
    return `${value}${value % 1 === 0 ? '.0' : ''}`;
  }
  if (Number.isInteger(value)) return value.toString();
  return value.toString();
}

function rustType(name, value) {
  if (Array.isArray(value)) {
    if (typeof value[0] === 'string') return '&[&str]';
    if (F32_RANGES.has(name)) return '(f32, f32)';
    return '(u32, u32)';
  }
  if (typeof value === 'string') return '&str';
  if (F32_CONSTS.has(name)) return 'f32';
  if (Number.isInteger(value)) return 'usize';
  return 'f32';
}

function generateRust(tsContent) {
  const { constants, comments } = parseTsFile(tsContent);

  function decl(name) {
    const value = constants[name];
    const comment = comments[name];
    const lines = [];
    if (comment) lines.push(`/// ${comment}`);
    lines.push(`pub const ${name}: ${rustType(name, value)} = ${formatRustValue(name, value)};`);
    return lines.join('\n');
  }

  const chatDecls = CHAT_CONSTS.map(decl).join('\n\n');
  const allowedDecls = ALLOWED_VALUES.map(decl).join('\n\n');
  const ragDecls = RAG_CONSTS.map(decl).join('\n\n');

  const now = new Date().toISOString().split('T')[0];

  return `//! AUTO-GENERATED by scripts/codegen-validation.mjs
//! Source of truth: packages/contracts/src/validation-limits.ts
//! DO NOT EDIT THIS FILE MANUALLY — changes will be overwritten.
//! Regenerate with: pnpm codegen:validation
//! Generated: ${now}

// ====================== CHAT / OLLAMA LIMITS ======================

${chatDecls}

// ====================== ALLOWED VALUES ======================

${allowedDecls}

// ====================== RAG LIMITS ======================

${ragDecls}
`;
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

function main() {
  const isCheck = process.argv.includes('--check');

  const tsContent = readFileSync(TS_SRC, 'utf-8');
  const rustCode = generateRust(tsContent);

  if (isCheck) {
    if (!existsSync(RUST_DST)) {
      console.error(
        '❌ generated_validation.rs does not exist. Run `pnpm codegen:validation` to create it.'
      );
      process.exit(1);
    }
    const current = readFileSync(RUST_DST, 'utf-8');
    if (current !== rustCode) {
      console.error(
        '❌ generated_validation.rs is out of date. Run `pnpm codegen:validation` to regenerate.'
      );
      process.exit(1);
    }
    console.log('✅ generated_validation.rs is up to date.');
    return;
  }

  writeFileSync(RUST_DST, rustCode, 'utf-8');
  console.log(`✅ Generated ${RUST_DST}`);
}

main();
