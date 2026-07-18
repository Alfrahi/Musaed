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
 *
 * Usage:
 *   pnpm validate:contracts          # report mismatches, exit 1 on issues
 *   pnpm validate:contracts --fix    # not implemented (manual fix required)
 *
 * This is the automated contract validation tool required by the Musaed
 * engineering standards (QWEN.md §10) and the audit report (Quick Win #3).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        const fnMatch = sig.match(
          /(?:pub\s+)?(?:async\s+)?fn\s+(cmd_\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/
        );
        if (!fnMatch) continue;

        const name = fnMatch[1];
        const rawArgs = fnMatch[2];
        const returnType = fnMatch[3] || '()';

        // Parse individual arguments, filtering out Tauri-injected params
        const args = rawArgs
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0);

        const userArgs = [];
        for (const arg of args) {
          // Extract just the parameter name (last token after colon and type)
          const parts = arg.split(':');
          const paramName = parts[0].trim();
          if (!isInjectedParam(paramName)) {
            userArgs.push(paramName);
          }
        }

        commands.set(name, {
          file: filePath.replace(RUST_SRC_DIR + '/', ''),
          argCount: userArgs.length,
          argNames: userArgs,
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

      // Extract arg names (before the colon)
      const argPattern = /(\w+)\??\s*:/g;
      let argMatch;
      while ((argMatch = argPattern.exec(argsBody)) !== null) {
        argNames.push(argMatch[1]);
      }
    } else {
      // Check for Record<string, never> (zero-arg)
      if (entryBody.includes('Record<string, never>')) {
        argNames = [];
      }
    }

    // Extract return type
    const returnMatch = entryBody.match(/return\s*:\s*([^;]+);/);
    const returnType = returnMatch ? returnMatch[1].trim() : 'unknown';

    commands.set(name, {
      argCount: argNames.length,
      argNames,
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
// 3. Cross-reference and report
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

function validate(rustCommands, tsCommands) {
  const issues = [];

  // 3a. Rust commands missing from TypeScript
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

  // 3b. TypeScript entries missing from Rust
  for (const [name, ts] of tsCommands) {
    if (!rustCommands.has(name)) {
      issues.push({
        type: 'TS_ONLY',
        severity: 'error',
        message: `TypeScript CommandMap entry "${name}" has no Rust #[tauri::command]. Dead IPC code.`,
      });
    }
  }

  // 3c. Argument count mismatches
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

  return issues;
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

function main() {
  console.log('🔍 Musaed Contract Validation');
  console.log('   Rust commands ↔ TypeScript CommandMap\n');

  const rustCommands = parseRustCommands();
  const tsCommands = parseTsCommandMap();

  console.log(`   Rust commands found: ${rustCommands.size}`);
  console.log(`   TypeScript entries found: ${tsCommands.size}\n`);

  const issues = validate(rustCommands, tsCommands);

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
  process.exit(errors.length > 0 ? 1 : 0);
}

main();