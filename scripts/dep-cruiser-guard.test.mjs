/**
 * Dep-cruiser guard test (AUDIT.txt §3.1, §17 Testing).
 *
 * The audit found "zero architectural tests" — dep-cruiser was reported green
 * even while dozens of cross-feature imports existed because the chassis was
 * wrongly wired. This test closes that gap. It runs dep-cruiser
 * programmatically against:
 *
 *   1. A deliberately polluted tree — a synthetic module that imports every
 *      sibling feature from inside `features/conversation/`. The manifest
 *      declares only `['library']` as a dep. The polluted module must trigger
 *      at least one `no-conversation-to-other-features` violation.
 *      This proves the rules actually fire — no more silent green.
 *
 *   2. The live codebase — every manifest's `dependencies:` array must match
 *      the generated `apps/web/src/generated-feature-deps.json`, *and* the
 *      live codebase must have zero violations. This guards against future
 *      regression of either the codegen or the import discipline.
 *
 * Lives in `scripts/` (not `apps/web/src/`) because it exercises the
 * repo-root `.dependency-cruiser.js` and the cwd-relative excludes.
 * Mirrors `validate-contracts.test.mjs` — runs via the `node:test` runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cruise } from 'dependency-cruiser';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WEB_SRC = resolve(ROOT, 'apps/web/src');
// dep-cruiser's `from`/`to` paths are relative to the cwd, and the rule
// engines match against `src/features/...`, so the cruise must run with the
// web app as cwd.
const WEB_APP = resolve(ROOT, 'apps/web');
const require = createRequire(import.meta.url);

async function runCruise(extraPaths = []) {
  const config = require(resolve(ROOT, '.dependency-cruiser.js'));
  // dep-cruiser's `from`/`to` path regexes match against paths relative to
  // the cruise's baseDir. The CLI runs from `apps/web/` so paths are
  // `src/features/...`. We replicate that by setting baseDir to the web app
  // root and passing paths relative to it.
  const baseDir = resolve(ROOT, 'apps/web');
  const result = await cruise(
    [
      'src/features',
      'src/lib',
      'src/store',
      'src/hooks',
      'src/app',
      ...extraPaths,
    ],
    {
      ...config.options,
      outputType: 'json',
      baseDir,
      // The CLI passes the entire config object as `ruleSet` (see
      // extract-depcruise-options.mjs line 18) and sets `validate: true`
      // when rules are present. Without `validate: true` the rule engine
      // skips evaluation entirely.
      ruleSet: config,
      validate: true,
    },
    { combinedDepths: false },
  );
  const parsed = JSON.parse(/** @type {string} */ (result.output));
  return {
    violations: parsed.summary?.violations ?? [],
    summary: parsed.summary,
  };
}

// ---------------------------------------------------------------------------
// Test 1: polluted tree must produce violations (proves rules fire)
// ---------------------------------------------------------------------------

test('manifest-driven rules fire on an undeclared cross-feature import', async () => {
  // Drop a synthetic module inside conversation that imports three siblings.
  // Conversation's manifest declares `dependencies: ['library']`, so the
  // settings + rag imports must trigger violations; library must NOT.
  const pollutedPath = resolve(WEB_SRC, 'features/conversation/__arch_guard_pollution__.ts');
  writeFileSync(
    pollutedPath,
    `// Temporary file created by scripts/dep-cruiser-guard.test.mjs — auto-removed.\n` +
      `// Importing three siblings to prove the manifest-driven rule fires.\n` +
      `// Use relative paths (not @/ aliases) so dep-cruiser can resolve them\n` +
      `// without tsPreCompilationDeps — the synthetic file isn't in tsconfig's\n` +
      `// include scope, so @/ path mapping won't work for it.\n` +
      `export const pollutionMarker = 1;\n` +
      `import '../library/index.ts';\n` +
      `import '../settings/index.ts';\n` +
      `import '../rag/index.ts';\n`,
    'utf-8',
  );

  try {
    // Pass the extra path relative to apps/web/ so dep-cruiser's path
    // regexes (which match against baseDir-relative paths) can see it.
    const result = await runCruise(['src/features/conversation/__arch_guard_pollution__.ts']);
    const convViolations = result.violations.filter((v) =>
      v.rule.name.startsWith('no-conversation-to-other-features'),
    );

    // We expect AT LEAST one violation targeting settings or rag (library is
    // declared, so it must NOT fire). The ridiculously low bar here is
    // deliberate — the point is "the rules fire at all", not "they fire for
    // every bad import". If this passes with zero, the chassis is silent
    // again (which is exactly what AUDIT.txt §3.1 reported).
    assert.ok(
      convViolations.length > 0,
      'dep-cruiser did NOT fire for a polluted conversation→{settings,rag} import. ' +
        'The architecture enforcement layer is silent — see AUDIT.txt §3.1.',
    );

    // And specifically: library (declared) must NOT be flagged.
    const libraryViolations = convViolations.filter((v) =>
      v.to.includes('features/library/'),
    );
    assert.equal(
      libraryViolations.length,
      0,
      'dep-cruiser flagged conversation→library, but conversation declares library as a ' +
        'manifest dependency. The manifest-driven rule is mis-wired.',
    );
  } finally {
    rmSync(pollutedPath, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: live codebase must be clean
// ---------------------------------------------------------------------------

test('live codebase has zero dep-cruiser violations', async () => {
  const result = await runCruise();
  const errors = result.violations.filter((v) => v.rule.severity === 'error');
  assert.equal(
    errors.length,
    0,
    'dep-cruiser found error-severity violations in the live codebase:\n' +
      errors
        .map((v) => `  - ${v.rule.name}: ${v.from} → ${v.to}`)
        .join('\n'),
  );
});

// ---------------------------------------------------------------------------
// Test 3: generated-feature-deps.json must match the manifests
// ---------------------------------------------------------------------------

test('generated-feature-deps.json is in sync with feature.manifest.ts files', async () => {
  // Re-run the codegen in a tmp output and diff against the checked-in file.
  // The codegen script writes to a fixed path, so we save/restore the
  // original bytes and run via spawnSync, then compare.
  const { spawnSync } = await import('node:child_process');
  const dstPath = resolve(WEB_SRC, 'generated-feature-deps.json');
  const original = readFileSync(dstPath, 'utf-8');

  // Regenerate, capture, restore, diff.
  const regen = spawnSync('node', [resolve(ROOT, 'scripts/codegen-feature-deps.mjs')], {
    encoding: 'utf-8',
  });
  if (regen.status !== 0) {
    // Restore before bailing.
    writeFileSync(dstPath, original, 'utf-8');
    assert.fail(`codegen:feature-deps failed to run: ${regen.stderr}`);
  }
  const regenerated = readFileSync(dstPath, 'utf-8');
  writeFileSync(dstPath, original, 'utf-8');

  assert.equal(
    regenerated,
    original,
    'apps/web/src/generated-feature-deps.json is out of sync with the feature.manifest.ts files. ' +
      'Run `pnpm codegen:feature-deps` and commit the regenerated file.',
  );
});
