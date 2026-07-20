#!/usr/bin/env node

/**
 * Contract Validation: Rust commands ↔ TypeScript CommandMap
 *
 * Parses every `#[tauri::command]` function from the Rust backend and every
 * entry in `CommandMap` from `apps/web/src/lib/ipc.ts`, then cross-references
 * them to detect:
 *
 *  1. Rust commands with no TypeScript counterpart (unreachable from frontend)
 *  2. TypeScript entries with no Rust command (dead IPC code)
 *  3. Argument count mismatches (excluding `app`/`window`/`state` params)
 *  4. (--strict) Argument type mismatches — Rust primitive/container types
 *     cross-checked against the TS `args:` declarations in CommandMap.
 *  5. (--strict) Return type mismatches — `ApiResponse<T>` and `Result<…, _>`
 *     wrappers are stripped, then the inner type is compared to the TS
 *     `return:` declaration.
 *
 * Usage:
 *   pnpm validate:contracts            # baseline (1, 2, 3); exit 1 on hard errors
 *   pnpm validate:contracts --strict   # also run (4, 5); exit 1 on TYPE_MISMATCH
 *   pnpm validate:contracts --fix      # not implemented (manual fix required)
 *
 * This is the automated contract validation tool required by the Musaed
 * engineering standards (STANDARDS.md §10) and the audit report (Quick Win #3).
 *
 * NOTE: The `--strict` tier is opt-in because full schema-level validation
 * would require adopting `specta::serde_types!` on the Rust side. Until then,
 * this validator performs conservative structural matching (primitives,
 * containers, optionals) and treats unresolved struct/enum types as compatible
 * when both sides reference the same identifier (e.g. `RagProject` on both
 * sides). Field-level drift inside those structs is not detected here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const RUST_SRC_DIR = resolve(ROOT, 'src-tauri/src');
const IPC_TS = resolve(ROOT, 'apps/web/src/lib/ipc.ts');

// ---------------------------------------------------------------------------
// 1. Parse Rust commands
// ---------------------------------------------------------------------------

/**
 * Tauri-injected parameters that are NOT part of the IPC contract.
 * These are provided by the Tauri runtime and should be excluded from
 * argument-count comparisons.
 */
const TAURI_INJECTED_PARAMS = new Set([
  'app',
  'window',
  'state',
  'handle',
  'app_handle',
  '_app_handle',
]);

/**
 * Parameter name patterns that indicate Tauri-managed or internal state
 * that is not part of the IPC contract exposed to the frontend.
 */
function isInjectedParam(paramName) {
  if (TAURI_INJECTED_PARAMS.has(paramName)) return true;
  // Arc<Mutex<...>> — Tauri state management
  if (paramName.startsWith('Arc<Mutex<') || paramName.startsWith('Arc<')) return true;
  // serde_json — internal serialization
  if (paramName === 'serde_json') return true;
  return false;
}

/**
 * Split a Rust parameter list on commas at angle-bracket depth zero, so
 * `HashMap<String, Value>` is preserved as a single token rather than
 * being split on its inner `,`. Also tolerates parentheses for tuple/
 * reference types.
 */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let parenDepth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ',' && depth === 0 && parenDepth === 0) {
      parts.push(s.substring(start, i));
      start = i + 1;
    }
  }
  if (start < s.length) parts.push(s.substring(start));
  return parts;
}

/**
 * Walk all .rs files under src-tauri/src/ and extract every
 * `#[tauri::command]` function signature.
 *
 * Returns a Map of command_name → { file, argCount, argNames }
 */
function parseRustCommands() {
  const commands = new Map();

  // Recursively collect .rs files
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.rs')) {
        extractFromFile(full);
      }
    }
  }

  function extractFromFile(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Detect #[tauri::command] attribute
      if (line === '#[tauri::command]') {
        // Look ahead for the function signature (may span multiple lines)
        let sigStart = i + 1;
        // Skip blank lines and other attributes
        while (
          sigStart < lines.length &&
          (lines[sigStart].trim() === '' || lines[sigStart].trim().startsWith('#['))
        ) {
          sigStart++;
        }

        if (sigStart >= lines.length) continue;

        // Collect the full signature (may span lines until '{')
        let sigLines = [];
        let j = sigStart;
        while (j < lines.length && !lines[j].includes('{')) {
          sigLines.push(lines[j].trim());
          j++;
        }
        // Include the opening brace line (may have trailing params)
        if (j < lines.length) {
          const braceLine = lines[j];
          const beforeBrace = braceLine.substring(0, braceLine.indexOf('{')).trim();
          if (beforeBrace) sigLines.push(beforeBrace);
        }

        const sig = sigLines.join(' ');

        // Parse: pub async fn cmd_foo<R: Runtime>(args...) -> ReturnType
        // The function may have generic params before the argument list.
        // Note: the return type capture goes up to `{` (body) so multi-token
        // generic returns like `Result<ApiResponse<RagProject>, String>` are
        // captured in full rather than truncating at the first space.
        const fnMatch = sig.match(
          /(?:pub\s+)?(?:async\s+)?fn\s+(cmd_\w+)(?:<[^>]*>)?\s*\(([\s\S]*?)\)(?:\s*->\s*([^{]+?))?\s*(?:\{|$)/
        );
        if (!fnMatch) continue;

        const name = fnMatch[1];
        const rawArgs = fnMatch[2];
        const returnType = (fnMatch[3] || '()').trim();

        // Parse individual arguments, filtering out Tauri-injected params.
        // Split on commas but respect angle-bracket nesting so generic
        // type parameters like `HashMap<String, Value>` stay together.
        const args = splitTopLevelCommas(rawArgs)
          .map((a) => a.trim())
          .filter((a) => a.length > 0);

        const userArgs = [];
        const userArgTypes = [];
        for (const arg of args) {
          // Extract parameter name (first token) and type (rest after the colon).
          // Handles patterns like `name: String`, `name: Option<String>`,
          // `name: Vec<ChatMessage>`, `_app_handle: AppHandle`.
          const colonIdx = arg.indexOf(':');
          if (colonIdx === -1) {
            // Destructured tuple patterns (`a, b): (...)`) — skip cleanly.
            continue;
          }
          const paramName = arg.substring(0, colonIdx).trim();
          const paramType = arg.substring(colonIdx + 1).trim();
          if (!isInjectedParam(paramName)) {
            userArgs.push(paramName);
            userArgTypes.push(paramType);
          }
        }

        commands.set(name, {
          file: filePath.replace(RUST_SRC_DIR + '/', ''),
          argCount: userArgs.length,
          argNames: userArgs,
          argTypes: userArgTypes,
          returnType,
        });

        i = j; // skip past the signature
      }
    }
  }

  walk(RUST_SRC_DIR);
  return commands;
}

// ---------------------------------------------------------------------------
// 2. Parse TypeScript CommandMap
// ---------------------------------------------------------------------------

/**
 * Parse the `CommandMap` interface from ipc.ts.
 *
 * Returns a Map of command_name → { argCount, argNames }
 */
function parseTsCommandMap() {
  const content = readFileSync(IPC_TS, 'utf-8');

  // Extract the CommandMap interface block — find the opening brace
  // after "export interface CommandMap" and extract everything up to
  // the matching closing brace.
  const ifaceStart = content.indexOf('export interface CommandMap {');
  if (ifaceStart === -1) {
    console.error('❌ Could not find CommandMap interface in ipc.ts');
    process.exit(1);
  }

  // Find the matching closing brace
  const braceStart = content.indexOf('{', ifaceStart);
  let depth = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }

  const body = content.substring(braceStart + 1, braceEnd);
  const commands = new Map();

  // Parse each entry: cmd_NAME: { args: { ... }; return: TYPE };
  // We need to handle nested braces in the args block.
  let pos = 0;
  while (pos < body.length) {
    // Skip whitespace, semicolons, and comment lines
    while (
      pos < body.length &&
      (/\s/.test(body[pos]) || body[pos] === ';' || body[pos] === '/')
    ) {
      // If it's a comment line (// ...), skip to end of line
      if (body[pos] === '/' && body[pos + 1] === '/') {
        while (pos < body.length && body[pos] !== '\n') pos++;
        continue;
      }
      pos++;
    }
    if (pos >= body.length) break;

    // Match command name
    const nameMatch = body.substring(pos).match(/^(cmd_\w+)\s*:/);
    if (!nameMatch) break;

    const name = nameMatch[1];
    pos += nameMatch[0].length;

    // Skip whitespace to find the opening brace of the entry value
    while (pos < body.length && /\s/.test(body[pos])) pos++;
    if (body[pos] !== '{') break;

    // Find the matching closing brace for this entry
    let entryDepth = 0;
    let entryStart = pos;
    let entryEnd = pos;
    for (let i = pos; i < body.length; i++) {
      if (body[i] === '{') entryDepth++;
      else if (body[i] === '}') {
        entryDepth--;
        if (entryDepth === 0) {
          entryEnd = i;
          break;
        }
      }
    }

    const entryBody = body.substring(entryStart + 1, entryEnd);

    // Extract args block
    const argsMatch = entryBody.match(/args\s*:\s*\{/);
    let argNames = [];
    let argTypes = [];
    let argOptional = [];
    if (argsMatch) {
      const argsStartInEntry = argsMatch.index + argsMatch[0].length;
      // Find matching closing brace for args
      let argsDepth = 1;
      let argsEnd = argsStartInEntry;
      for (let i = argsStartInEntry; i < entryBody.length; i++) {
        if (entryBody[i] === '{') argsDepth++;
        else if (entryBody[i] === '}') {
          argsDepth--;
          if (argsDepth === 0) {
            argsEnd = i;
            break;
          }
        }
      }
      const argsBody = entryBody.substring(argsStartInEntry, argsEnd);

      // Split args entries by `;` separator so multi-line types remain on
      // their owning arg.
      const rawEntries = argsBody.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
      for (const entry of rawEntries) {
        // Skip records/keyless shapes — they don't carry named arg metadata we need.
        if (entry.startsWith('Record<') || entry.startsWith('{') || entry.startsWith('[')) continue;
        // Match `name?: TYPE` or `name: TYPE` (with the optional `?`).
        const m = entry.match(/^(\w+)(\?)?\s*:\s*([\s\S]+)$/);
        if (!m) continue;
        const argName = m[1];
        const isOptional = Boolean(m[2]);
        const argType = m[3].trim();
        argNames.push(argName);
        argTypes.push(argType);
        argOptional.push(isOptional);
      }
    } else {
      // Check for Record<string, never> (zero-arg)
      if (entryBody.includes('Record<string, never>')) {
        argNames = [];
      }
    }

    // Extract return type. The trailing `;` is optional in the actual
    // CommandMap: many entries end with `return: T }` (no semicolon before
    // the closing brace). Accept either a `;` or end-of-string.
    const returnMatch = entryBody.match(/return\s*:\s*([^;]+?)(?:;|\s*$)/);
    const returnType = returnMatch ? returnMatch[1].trim() : 'unknown';

    commands.set(name, {
      argCount: argNames.length,
      argNames,
      argTypes,
      argOptional,
      returnType,
    });

    pos = entryEnd + 1;

    // Skip trailing semicolon, whitespace, and comments after the entry's closing brace
    while (
      pos < body.length &&
      (/\s/.test(body[pos]) || body[pos] === ';' || body[pos] === '/')
    ) {
      if (body[pos] === '/' && body[pos + 1] === '/') {
        while (pos < body.length && body[pos] !== '\n') pos++;
        continue;
      }
      pos++;
    }
  }

  return commands;
}

// ---------------------------------------------------------------------------
// 3. Type normalisation and comparison (--strict only)
// ---------------------------------------------------------------------------

/**
 * `tauri::command` return types in this codebase consistently use one of two
 * shapes:
 *
 *   Result<ApiResponse<T>, String>     — most commands (dominated)
 *   Result<ApiResponse<T>, tauri::Error>  — conversation/commands.rs
 *   ApiResponse<T>                      — opener/ollama/logs/trace commands
 *   ()                                  — pub async fn cmd_foo(...) { ... } (no explicit)
 *
 * `stripResultWrappers` peels off `Result<…, _>` (error type ignored) and
 * `ApiResponse<…>` so the inner payload type can be compared directly against
 * the TS `return:` declaration.
 */
function stripResultWrappers(type) {
  let t = type.trim();
  // Strip leading `async ` token if a future extraction ever introduces it.
  t = t.replace(/^async\s+/, '');
  // Recursively peel `Result<…, ERROR>` and `ApiResponse<…>`.
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^Result<([\s\S]+),\s*[^>]+>$/, '$1').trim();
    t = t.replace(/^ApiResponse<([\s\S]+)>$/, '$1').trim();
    if (t === '()') return 'void';
    if (t === before) break;
  }
  // Bare `()` → `void`, `String` errors dropping normalises to `String` only
  // when no Result wrap was present (shouldn't happen in practice after the loop above).
  return t;
}

/**
 * Normalise a Rust *parameter* type into a structural token table:
 *
 *   { base, optional, array, atomic }
 *
 * `base` is the innermost named type (e.g. `String`, `RagProject`).
 * `optional` is true for `Option<T>` wrappers.
 * `array` is true for `Vec<T>` wrappers.
 * `atomic` is true for primitives and special markers (e.g. `String`, `bool`,
 * numeric types, `()` for void) — these compare structurally against TS
 * primitives without needing identical identifier spelling.
 */
function normalizeRustParamType(raw) {
  let t = raw.trim();
  let optional = false;
  let array = false;

  // Strip leading `&` (reference) and any `'_` lifetime.
  t = t.replace(/^&'?[A-Za-z0-9_]*\s*/, '');
  // Strip trailing whitespace-only markers (e.g. just `'_`).
  t = t.replace(/\s*'_\s*$/, '').trim();

  for (let i = 0; i < 4; i++) {
    const before = t;
    const optionalMatch = t.match(/^Option<([\s\S]+)>$/);
    if (optionalMatch) {
      optional = true;
      t = optionalMatch[1].trim();
    }
    const vecMatch = t.match(/^Vec<([\s\S]+)>$/);
    if (vecMatch) {
      array = true;
      t = vecMatch[1].trim();
    }
    if (t === before) break;
  }

  // Bare `()` → treated as void primitive.
  if (t === '()') {
    return { base: 'void', optional, array, atomic: true };
  }

  const isAtomic =
    t === 'String' ||
    t === 'str' ||
    t === 'bool' ||
    t === 'char' ||
    t === 'u8' || t === 'u16' || t === 'u32' || t === 'u64' ||
    t === 'i8' || t === 'i16' || t === 'i32' || t === 'i64' ||
    t === 'usize' || t === 'isize' ||
    t === 'f32' || t === 'f64';

  return { base: t, optional, array, atomic: isAtomic };
}

/**
 * Normalise a TS type expression into the same { base, optional, array, atomic }
 * shape so it can be structurally compared against a Rust param. The TS type
 * grammar is permissive (e.g. `Partial<T>`, `Record<string, X>`, `Array<X>`);
 * this normalizer handles the subset actually present in CommandMap.
 */
function normalizeTsParamType(raw) {
  let t = raw.trim();
  let optional = false;
  let array = false;

  if (t === 'void' || t === 'undefined' || t === 'null') {
    return { base: t, optional: false, array: false, atomic: true };
  }

  // Strip outer parentheses, if any.
  while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim();

  for (let i = 0; i < 6; i++) {
    const before = t;
    // `Array<X>` → array
    const arrayGeneric = t.match(/^Array<([\s\S]+)>$/);
    if (arrayGeneric) {
      array = true;
      t = arrayGeneric[1].trim();
    }
    if (t.endsWith('[]')) {
      array = true;
      t = t.slice(0, -2).trim();
    }
    // `Partial<T>` and friends — peel the wrapper, treat `name` as optional only if explicit.
    const partialMatch = t.match(/^Partial<([\s\S]+)>$/);
    if (partialMatch) {
      // `Partial<X>` makes every field optional; in CommandMap this is the
      // signal used for "all args optional". We leave optionality to the
      // argument-level `?` flag, but peel the wrapper so the inner X is
      // compared directly.
      t = partialMatch[1].trim();
    }
    if (t === before) break;
  }

  const isAtomic =
    t === 'string' ||
    t === 'number' ||
    t === 'boolean' ||
    t === 'bigint' ||
    t === 'object' ||
    t === 'unknown' ||
    t === 'any' ||
    t === 'never' ||
    t === 'null' ||
    t === 'undefined';

  return { base: t, optional, array, atomic: isAtomic };
}

/**
 * Convert snake_case to camelCase (Rust arg names → TS arg names). Words
 * separated by leading underscores are merged case-by-case; leading
 * underscores are preserved so `_app_handle` stays identifier-distinct.
 */
function snakeToCamel(name) {
  const leadingUnderscores = (name.match(/^_*/) || [''])[0];
  const rest = name.slice(leadingUnderscores.length);
  const parts = rest.split('_').filter(Boolean);
  if (parts.length === 0) return name;
  const camel = parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return leadingUnderscores + camel;
}

/**
 * Decide whether a Rust normal-form param and a TS normal-form param are
 * structurally equivalent. The rules:
 *
 *   1. Both atomic? Map Rust primitive → TS primitive equivalent.
 *   2. Both array? Compare element types recursively.
 *   3. Optional/required: Rust `Option<T>` ↔ TS `T | undefined` / TS `?:` flag.
 *      If neither side is marked optional we still allow it (a TS required
 *      arg can correspond to a required Rust arg).
 *   4. Both named types? Compare the identifier (e.g. `RagProject` ↔ `RagProject`).
 *      Different identifiers ⇒ mismatch (we don't try to resolve cross-file).
 */
const RUST_ATOMIC_TO_TS = {
  String: 'string',
  str: 'string',
  bool: 'boolean',
  char: 'string',
  u8: 'number', u16: 'number', u32: 'number', u64: 'number',
  i8: 'number', i16: 'number', i32: 'number', i64: 'number',
  usize: 'number', isize: 'number',
  f32: 'number', f64: 'number',
  void: 'void',
};

function equivalentType(rust, ts, tsOptional) {
  // Both atomic — compare via the Rust→TS primitive map.
  if (rust.atomic && ts.atomic) {
    return RUST_ATOMIC_TO_TS[rust.base] === ts.base;
  }
  // Atomic on one side, named on the other ⇒ mismatch.
  if (rust.atomic !== ts.atomic) return false;

  // Special‑case HashMap ↔ Record as equivalent containers.
  if (rust.base.startsWith('HashMap') && ts.base.startsWith('Record')) {
    return true;
  }

  // Both arrays: compare element types (recursively).
  if (rust.array !== ts.array) return false;

  // Both named / unresolved types: compare identifier spelling.
  // Allow `String → string` only when ts is the atomic — already handled above.
  if (rust.base !== ts.base) return false;

  // Optional compatibility: Rust `Option<T>` (optional=true) is compatible
  // with TS arg whose `?` was set OR whose type expression includes `undefined`.
  // A required Rust arg must not be matched with a TS arg that is explicitly
  // optional — caller decides via the rustOptional flag.
  if (rust.optional && !tsOptional) {
    // Acceptable when the TS type itself embeds `undefined` (rare). We treat
    // `T | undefined` as optional too — the parser doesn't currently capture
    // union types, so callers can rely on the `?` flag.
  }
  return true;
}

/**
 * Compare a single Rust command's normalised spec to a single TS CommandMap
 * entry's spec. Returns a list of `TYPE_MISMATCH` issues for arg or return
 * type drift. Empty array ⇒ no drift detected.
 *
 * Args are matched by name after snake→camel conversion so that Rust
 * `project_id` <=> TS `projectId` and Rust `base_url` <=> TS `baseUrl`
 * line up correctly. When names don't match, the issue is reported as an
 * arg-name drift, with the count of mismatches computed explicitly.
 */
function compareCommandStrict(rustName, rust, ts) {
  const issues = [];

  // ---- Argument drift ---------------------------------------------------
  // Build Rust→TS name lookup keyed by the camel-cased name, falling back
  // to the raw snake_case identifier if a direct hit was missed.
  const tsByNormalized = new Map();
  for (let i = 0; i < ts.argNames.length; i++) {
    tsByNormalized.set(ts.argNames[i], i);
  }

  for (let i = 0; i < rust.argNames.length; i++) {
    const rustArgName = rust.argNames[i];
    const camel = snakeToCamel(rustArgName);

    let tsIdx = tsByNormalized.get(camel);
    if (tsIdx === undefined) tsIdx = tsByNormalized.get(rustArgName);
    if (tsIdx === undefined) {
      issues.push({
        type: 'TYPE_MISMATCH',
        severity: 'error',
        message: `"${rustName}": Rust arg "${rustArgName}" has no TypeScript counterpart (camel: "${camel}").`,
      });
      continue;
    }

    const rustNorm = normalizeRustParamType(rust.argTypes[i]);
    const tsNorm = normalizeTsParamType(ts.argTypes[tsIdx]);
    const tsOptional = Boolean(ts.argOptional?.[tsIdx]);

    // If Rust is `Option<T>` but TS arg is required (no `?`), that's a
    // contract drift too — but the converse (TS optional, Rust required)
    // also matters. We only flag a *type* mismatch when equivalence fails.
    // Optionality skew is reported as `TYPE_MISMATCH` with an explicit hint.
    const typesMatch = equivalentType(rustNorm, tsNorm, tsOptional);
    if (!typesMatch) {
      issues.push({
        type: 'TYPE_MISMATCH',
        severity: 'error',
        message: `"${rustName}": arg "${camel}" — Rust "${rust.argTypes[i]}" vs TypeScript "${ts.argTypes[tsIdx]}".`,
      });
    } else if (rustNorm.optional !== tsOptional) {
      // Optional skew is a softer signal; emit it as a warning so CI without
      // --strict still benefits, but only fail --strict on hard errors below.
      issues.push({
        type: 'TYPE_MISMATCH',
        severity: 'warning',
        message: `"${rustName}": arg "${camel}" optionality skew — Rust "${rust.argTypes[i]}" (Option=${rustNorm.optional}) vs TypeScript "${ts.argTypes[tsIdx]}" (?=${tsOptional}).`,
      });
    }
  }

  // Catch extra TS-side args that have no Rust counterpart.
  for (let i = 0; i < ts.argNames.length; i++) {
    const tsName = ts.argNames[i];
    const matched = rust.argNames.some((rn) => snakeToCamel(rn) === tsName || rn === tsName);
    if (!matched) {
      issues.push({
        type: 'TYPE_MISMATCH',
        severity: 'error',
        message: `"${rustName}": TypeScript arg "${tsName}" has no Rust counterpart.`,
      });
    }
  }

  // ---- Return-type drift ------------------------------------------------
  // Strip the `Result<…>` / `ApiResponse<…>` wrappers on the Rust side,
  // then run the same structural comparison as for parameters so that
  // `bool` ↔ `boolean`, `Vec<RagProject>` ↔ `RagProject[]`, etc. line up.
  const rustReturnStripped = stripResultWrappers(rust.returnType);
  const tsReturnNorm = (ts.returnType || 'unknown').trim();
  const rustReturnNorm = normalizeRustParamType(rustReturnStripped);
  const tsReturnNormalized = normalizeTsParamType(tsReturnNorm);

  const rustIsVoid = rustReturnNorm.base === 'void' || rustReturnStripped === '()';
  const tsIsVoid = tsReturnNorm === 'void';
  const voidMatch = rustIsVoid && tsIsVoid;

  // Critical pair: `unknown` on the TS side is treated as a structural
  // wildcard ("the contract author hasn't pinned the return type"), so we
  // don't flag `unknown` vs anything. Most actual CommandMap entries do
  // declare concrete returns; the parser falls back to `unknown` only when
  // the entry body has no `return:` field at all.
  const tsIsUnknown = tsReturnNorm === 'unknown';

  const returnTypeMatches =
    voidMatch ||
    tsIsUnknown ||
    equivalentType(rustReturnNorm, tsReturnNormalized, false);

  if (!returnTypeMatches) {
    issues.push({
      type: 'TYPE_MISMATCH',
      severity: 'error',
      message: `"${rustName}": return type drift — Rust "${rust.returnType}" (→ "${rustReturnStripped}") vs TypeScript "${ts.returnType}".`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 4. Cross-reference and report
// ---------------------------------------------------------------------------

/**
 * Commands that are intentionally internal-only (called by the Rust backend,
 * not by the frontend). These are exempt from requiring a TypeScript
 * CommandMap entry.
 */
const INTERNAL_ONLY_COMMANDS = new Set([
  'cmd_run_migrations',
  'cmd_rollback_migrations',
  'cmd_get_migration_status',
  'cmd_list_migrations',
]);

function validate(rustCommands, tsCommands, { strict = false } = {}) {
  const issues = [];

  // 4a. Rust commands missing from TypeScript
  for (const [name, rust] of rustCommands) {
    if (!tsCommands.has(name)) {
      const severity = INTERNAL_ONLY_COMMANDS.has(name) ? 'warning' : 'error';
      issues.push({
        type: 'RUST_ONLY',
        severity,
        message: `Rust command "${name}" (${rust.file}) has no TypeScript CommandMap entry.${severity === 'warning' ? ' (internal-only, may be intentional)' : ' Frontend cannot call it.'}`,
      });
    }
  }

  // 4b. TypeScript entries missing from Rust
  for (const [name, ts] of tsCommands) {
    if (!rustCommands.has(name)) {
      issues.push({
        type: 'TS_ONLY',
        severity: 'error',
        message: `TypeScript CommandMap entry "${name}" has no Rust #[tauri::command]. Dead IPC code.`,
      });
    }
  }

  // 4c. Argument count mismatches
  for (const [name, rust] of rustCommands) {
    const ts = tsCommands.get(name);
    if (!ts) continue;

    if (rust.argCount !== ts.argCount) {
      issues.push({
        type: 'ARG_MISMATCH',
        severity: 'error',
        message: `"${name}": Rust expects ${rust.argCount} args (${rust.argNames.join(', ') || 'none'}), TypeScript declares ${ts.argCount} args (${ts.argNames.join(', ') || 'none'}).`,
      });
    }
  }

  // 4d. (--strict) Type mismatches — argument and return type drift
  if (strict) {
    for (const [name, rust] of rustCommands) {
      const ts = tsCommands.get(name);
      if (!ts) continue;
      const strictIssues = compareCommandStrict(name, rust, ts);
      issues.push(...strictIssues);
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const baseline = args.includes('--baseline');

  if (strict && baseline) {
    console.error('❌ Cannot use both --strict and --baseline flags');
    process.exit(1);
  }

  console.log('🔍 Musaed Contract Validation');
  console.log(`   Rust commands ↔ TypeScript CommandMap${strict ? ' (strict mode)' : ''}\n`);

  const rustCommands = parseRustCommands();
  const tsCommands = parseTsCommandMap();

  console.log(`   Rust commands found: ${rustCommands.size}`);
  console.log(`   TypeScript entries found: ${tsCommands.size}\n`);

  const issues = validate(rustCommands, tsCommands, { strict });

  if (issues.length === 0) {
    console.log('✅ All contracts aligned. No mismatches detected.');
    process.exit(0);
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  console.log(`❌ ${errors.length} error(s), ${warnings.length} warning(s)\n`);

  for (const issue of issues) {
    const prefix = issue.severity === 'error' ? '❌' : '⚠️';
    console.log(`   ${prefix} [${issue.type}] ${issue.message}`);
  }

  console.log('');
  // Exit with code 1 only if there are errors (warnings are advisory)
  // In strict mode, TYPE_MISMATCH errors also cause failure.
  process.exit(errors.length > 0 ? 1 : 0);
}

// ESM guard: only auto-run when invoked directly, not when imported
const isMainModule =
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main();
}

// Export pure functions for programmatic use (e.g., tests)
export {
  parseRustCommands,
  parseTsCommandMap,
  validate,
  stripResultWrappers,
  normalizeRustParamType,
  normalizeTsParamType,
  snakeToCamel,
  equivalentType,
  compareCommandStrict,
  INTERNAL_ONLY_COMMANDS,
};
