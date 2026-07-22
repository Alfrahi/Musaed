#!/usr/bin/env node

/**
 * Codegen: feature.manifest.ts → generated-feature-deps.json
 *
 * Reads every apps/web/src/features/{name}/feature.manifest.ts, parses the
 * `dependencies` array, and emits a JSON object the architecture
 * checker can consume — so dep-cruiser can honor each feature's declared
 * dependency list instead of enforcing an unconditional cross-feature ban.
 *
 * This closes the AUDIT.txt §3.1 gap: the manifest's `dependencies` field
 * was documentation only. With this script + the dep-cruiser rule that
 * reads the generated JSON, `dependencies` becomes a machine-validated
 * contract: any cross-feature import not listed here is a CI failure.
 *
 * Usage:
 *   pnpm codegen:feature-deps          # write generated file
 *   pnpm codegen:feature-deps:check    # diff only, exit 1 on mismatch
 *
 * See STANDARDS.md §3 Feature IMPORT rules and §19 Architecture drift.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FEATURES_DIR = resolve(ROOT, 'apps/web/src/features');
const DST = resolve(ROOT, 'apps/web/src/generated-feature-deps.json');

// ---------------------------------------------------------------------------
// 1. Discover manifests
// ---------------------------------------------------------------------------

function discoverManifests() {
  const featureDirs = readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const manifests = [];
  for (const name of featureDirs) {
    const manifestPath = join(FEATURES_DIR, name, 'feature.manifest.ts');
    if (!existsSync(manifestPath)) {
      console.warn(`⚠️  feature "${name}" has no feature.manifest.ts — skipping.`);
      continue;
    }
    const src = readFileSync(manifestPath, 'utf-8');
    const deps = parseDependencies(src);
    manifests.push({ feature: name, dependencies: deps });
  }
  return manifests;
}

/**
 * Parse the `dependencies: [...]` array out of a manifest's source text.
 * Doing this with a regex instead of importing the TS means the script has
 * no build step and can run anywhere `node` does — matching the
 * codegen-validation.mjs precedent.
 */
function parseDependencies(src) {
  // Match `dependencies: [ 'a', "b", ... ]` (single line, multi line, trailing comma).
  const match = src.match(/dependencies:\s*\[([^\]]*)\]/m);
  if (!match) {
    throw new Error(
      `Malformed manifest: no dependencies:[] array found. Every feature.manifest.ts must declare dependencies (use an empty array if none).`
    );
  }
  const inner = match[1].trim();
  if (inner === '') return [];

  // Strip any trailing comment after the array contents — naive but matches
  // the project's manifest house style (one inline comment per declaration).
  const deps = [];
  for (const part of inner.split(',')) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    // Inline `// comments` can glue a quoted dep to the *previous* comma part
    // (e.g. `'a', // foo \n 'b'`). Match the first quoted string anywhere in
    // the part, not just at start, so trailing deps on comment-strewn arrays
    // are still picked up.
    const strMatch = cleaned.match(/['"]([^'"]+)['"]/);
    if (!strMatch) {
      // Likely a trailing comment fragment such as `// text here`. Skip.
      continue;
    }
    deps.push(strMatch[1]);
  }
  return deps;
}

// ---------------------------------------------------------------------------
// 2. Generate JSON
// ---------------------------------------------------------------------------

/**
 * Output shape: a feature→deps map. Keeping it minimal so the dep-cruiser
 * config can resolve a feature's allowed import targets with a single lookup.
 *
 * Format: 2-space object indentation with each deps array inlined onto the
 * same line as its key (e.g. `"conversation": ["library"],`). We hand-format
 * instead of using `JSON.stringify(_, _, 2)` because the latter expands every
 * array to one element per line, which disagrees with the committed file's
 * compact form and causes `codegen:feature-deps:check` to fail whenever the
 * codegen is re-run. The manually-rendered shape keeps each array inline, so
 * a deps change only moves the affected line.
 */
function generateJson(manifests) {
  const map = {};
  for (const { feature, dependencies } of manifests) {
    map[feature] = dependencies;
  }
  const keys = Object.keys(map);
  const lines = ['{'];
  keys.forEach((key, i) => {
    const deps = map[key].map((d) => `"${d}"`).join(', ');
    const trailing = i < keys.length - 1 ? ',' : '';
    lines.push(`  ${JSON.stringify(key)}: [${deps}]${trailing}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

function main() {
  const isCheck = process.argv.includes('--check');

  const manifests = discoverManifests();
  const json = generateJson(manifests);

  if (isCheck) {
    if (!existsSync(DST)) {
      console.error(
        `❌ ${DST} does not exist. Run \`pnpm codegen:feature-deps\` to create it.`
      );
      process.exit(1);
    }
    const current = readFileSync(DST, 'utf-8');
    if (current !== json) {
      console.error(
        `❌ ${DST} is out of date. Run \`pnpm codegen:feature-deps\` to regenerate.\n` +
          `   This usually means a feature.manifest.ts \`dependencies\` array was edited without re-running codegen.`
      );
      process.exit(1);
    }
    console.log(`✅ ${DST} is up to date.`);
    return;
  }

  writeFileSync(DST, json, 'utf-8');
  console.log(`✅ Generated ${DST}`);
}

main();
