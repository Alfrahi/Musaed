#!/usr/bin/env node
'use strict';

/**
 * Verifies that every `#[tauri::command]` registered in the invoke handler
 * (src-tauri/src/lib.rs) is covered by the Tauri 2 capability ACL:
 *
 *   1. Every registered `cmd_*` appears in some permissions/*.toml
 *      `commands.allow` list.
 *   2. Every custom permission identifier referenced from
 *      capabilities/default.json exists as an `identifier` in some
 *      permissions/*.toml file.
 *   3. Inverse drift: commands listed in a permission file but no longer
 *      registered in lib.rs are errors — Tauri builds fail at runtime ACL
 *      resolution when a permission names an unknown command.
 *
 * Silent drift here makes commands fail at runtime with
 * "not allowed. Command not found" — invisible to `validate:contracts`
 * and all type checks (see: cmd_ollama_validate_model regression).
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const LIB_RS = join(PROJECT_ROOT, 'src-tauri/src/lib.rs');
const PERMISSIONS_DIR = join(PROJECT_ROOT, 'src-tauri/permissions');
const CAPABILITIES_DIR = join(PROJECT_ROOT, 'src-tauri/capabilities');

/** Extract every `cmd_*` identifier listed in the invoke handler. */
function registeredCommands() {
  const source = readFileSync(LIB_RS, 'utf-8');
  const handler = source.match(/generate_handler!\s*\[[\s\S]*?\]/);
  if (!handler) throw new Error('generate_handler block not found in lib.rs');
  return new Set(handler[0].match(/\bcmd_[a-z0-9_]+\b/g) ?? []);
}

/** Parse permissions/*.toml → { identifier, commands[] }[] */
function permissionFiles() {
  return readdirSync(PERMISSIONS_DIR)
    .filter((f) => f.endsWith('.toml'))
    .map((file) => {
      const content = readFileSync(join(PERMISSIONS_DIR, file), 'utf-8');
      return {
        file,
        identifier: content.match(/^\s*identifier\s*=\s*"([^"]+)"/m)?.[1] ?? null,
        commands: [...content.matchAll(/"(cmd_[a-z0-9_]+)"/g)].map((m) => m[1]),
      };
    });
}

/** Collect the permission identifiers referenced by every capability file. */
function capabilityIdentifiers() {
  const ids = [];
  for (const file of readdirSync(CAPABILITIES_DIR).filter((f) => f.endsWith('.json'))) {
    const json = JSON.parse(readFileSync(join(CAPABILITIES_DIR, file), 'utf-8'));
    for (const perm of json.permissions ?? []) {
      const id = typeof perm === 'string' ? perm : perm.identifier;
      if (id && !id.includes(':')) ids.push(id); // custom identifiers only (no plugin scopes)
    }
  }
  return ids;
}

const registered = registeredCommands();
const perms = permissionFiles();
const allowed = new Set(perms.flatMap((p) => p.commands));

const errors = [];

for (const cmd of [...registered].sort()) {
  if (!allowed.has(cmd)) {
    errors.push(
      `${cmd} is registered in lib.rs but missing from every permissions/*.toml allow list`
    );
  }
}

for (const pm of perms) {
  if (!pm.identifier) {
    errors.push(`${pm.file}: no identifier found`);
    continue;
  }
  for (const cmd of pm.commands) {
    if (!registered.has(cmd)) {
      errors.push(`${pm.file}: allows ${cmd}, which is not registered in lib.rs (stale entry)`);
    }
  }
}

const availableIds = new Set(perms.map((p) => p.identifier));
for (const id of capabilityIdentifiers()) {
  if (!availableIds.has(id)) {
    errors.push(`capabilities reference "${id}", but no permissions/*.toml defines it`);
  }
}

if (errors.length) {
  console.error('❌ IPC ACL validation failed:');
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}

console.log(
  `✅ IPC ACL aligned: ${registered.size} registered commands, ${perms.length} permission files.`
);
