/**
 * @type {import('dependency-cruiser').IConfiguration}
 *
 * Cross-feature import rules are generated from each feature's manifest
 * `dependencies:` array. See scripts/codegen-feature-deps.mjs and the
 * generated apps/web/src/generated-feature-deps.json. Every feature may import
 * from any feature it explicitly declares as a dependency; any other
 * cross-feature import is an error. `layout` is exempt from this rule
 * entirely — it is the composition root (see features/layout/README.md and
 * STANDARDS.md §3).
 *
 * If generated-feature-deps.json is missing or empty, the manifest-driven
 * rule degrades to a hard ban (every cross-feature import errors), so a
 * misconfigured tree fails loud and early rather than silently passing.
 */

/**
 * Features exempt from cross-feature import rules.
 *
 * These features are composition roots that mount other features by design.
 * Adding a feature to this list is a Tier 3 architectural change
 * (STANDARDS.md §20) and requires updating STANDARDS.md §3.
 */
const EXEMPT_FEATURES = ['layout'];

const featureDeps = loadFeatureDeps();

function loadFeatureDeps() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./apps/web/src/generated-feature-deps.json');
  } catch {
    return null;
  }
}

function buildCrossFeatureRules() {
  const features = ['conversation', 'info', 'library', 'rag', 'settings', 'sidebar'];
  return features
    .filter((feature) => !EXEMPT_FEATURES.includes(feature))
    .map((feature) => {
    const allowed = featureDeps?.[feature] ?? [];
    // Build a regex that matches a path under ANY feature dir EXCEPT:
    //   - the source feature itself (intra-feature imports are fine)
    //   - any feature explicitly declared in this feature's manifest
    //     `dependencies: [...]`
    // For sidebar→conversation: sidebar's manifest declares no deps, so the
    // rule bans sidebar importing anything except files under
    // src/features/sidebar/ itself.
    // For conversation→library: conversation's manifest declares
    // `dependencies: ['library']`, so the lookahead group becomes
    // `(?!library|conversation)`, allowing implicit self-imports and the
    // declared library edge, while banning every other sibling.
    const exempt = [feature, ...allowed].join('|');
    const targetPattern = `^src/features/(?!${exempt}/)`;
    return {
      name: `no-${feature}-to-other-features`,
      comment: `${feature} feature must not import siblings — only features declared in its manifest dependencies: ${JSON.stringify(allowed)}`,
      from: { path: `^src/features/${feature}/` },
      to: { path: targetPattern },
      severity: 'error',
    };
  });
}

module.exports = {
  forbidden: [
    // ── 1. Circular dependencies ──────────────────────────────
    {
      name: 'no-circular',
      comment: 'Circular dependencies create hidden coupling and break tree-shaking.',
      from: {},
      to: { circular: true },
      severity: 'error',
    },

    // ── 2. Cross-feature imports (manifest-driven DDD boundary) ───
    // `layout` is intentionally exempt: it is the composition root that
    // mounts every other feature (see features/layout/README.md). It has no
    // `no-layout-to-other-features` rule.
    ...buildCrossFeatureRules(),

    // ── 3. Feature internals only accessible via index.ts ────
    // Code outside a feature may only import its barrel (index.ts).
    {
      name: 'no-external-feature-internals',
      comment: 'Feature internals are private. Import only from feature barrel (index.ts).',
      from: { path: '^src/', pathNot: '^src/features/' },
      to: {
        path: '^src/features/[^/]+/',
        pathNot: '^src/features/[^/]+/index\\.ts$',
      },
      severity: 'error',
    },

    // ── 4. Direct Tauri API access ───────────────────────────
    {
      name: 'no-direct-tauri-api',
      comment: 'Use src/lib/ipc.ts — direct @tauri-apps/api usage is forbidden.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/lib/ipc\\.ts$',
          '^src/lib/tauri-storage\\.ts$',
          '^src/__mocks__/',
          '^src/tests/',
          '^src/.*\\.test\\.',
        ],
      },
      to: { path: '^@tauri-apps/api' },
      severity: 'error',
    },

    // ── 5. Direct Tauri plugin access ────────────────────────
    {
      name: 'no-direct-tauri-plugin',
      comment: 'Tauri plugins must be accessed via src/lib/ipc.ts only.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/lib/ipc\\.ts$',
          '^src/lib/tauri-storage\\.ts$',
          '^src/__mocks__/',
          '^src/tests/',
          '^src/.*\\.test\\.',
        ],
      },
      to: { path: '^@tauri-apps/plugin-' },
      severity: 'error',
    },

    // ── 6. Store must not depend on features ────────────────
    {
      name: 'no-store-to-feature',
      comment: 'Stores are shared infrastructure — must not depend on feature internals.',
      from: { path: '^src/store/' },
      to: { path: '^src/features/' },
      severity: 'error',
    },

    // ── 7. lib/ must not depend on features ──────────────────
    {
      name: 'no-lib-to-feature',
      comment: 'lib/ is shared infrastructure — must not depend on features.',
      from: { path: '^src/lib/' },
      to: { path: '^src/features/' },
      severity: 'error',
    },

    // ── 8. components/ui/ must stay feature-agnostic ─────────
    // STANDARDS.md §3: components in @/components/ui/ SHOULD be feature-agnostic
    // design primitives (buttons, modals, skeletons, badges). A component that
    // needs feature-specific behavior SHOULD live in the feature that owns it.
    // This `warn` rule flags any components/ui/ → @/features/* import so the
    // workaround pattern (relocating a feature component into the shared UI
    // layer to dodge cross-feature import rules) can be caught in review.
    {
      name: 'no-ui-to-feature',
      comment:
        'components/ui/ should be feature-agnostic primitives. Move feature-specific components into the owning feature. See STANDARDS.md §3.',
      from: { path: '^src/components/ui/' },
      to: { path: '^src/features/' },
      severity: 'warn',
    },

    // ── 9. hooks/ must not depend on features (allow-listed) ──
    {
      name: 'no-hooks-to-features',
      comment:
        'src/hooks/ is shared infrastructure. Hooks that cross feature ' +
        'boundaries must be explicitly allow-listed. See STANDARDS.md §3.',
      from: { path: '^src/hooks/' },
      to: {
        path: '^src/features/',
        pathNot: [
          // useAppInitialization — boot orchestrator that coordinates
          // settings, library, and conversation at startup. Lives in
          // hooks/ because no single feature owns cross-feature init.
          '^src/features/settings/index\\.ts$',
          '^src/features/library/index\\.ts$',
          '^src/features/conversation/index\\.ts$',
          // useGlobalShortcuts — registers app-wide keyboard shortcuts
          // that span conversation, settings, library, and info features.
          '^src/features/conversation/index\\.ts$',
        ],
      },
      severity: 'error',
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: [
        'node_modules',
        'dist',
        '^apps/web/out',
        '.next',
        'target',
        'coverage',
        'src-tauri',
        '__mocks__',
        '\\.test\\.',
        '\\.spec\\.',
        '\\.d\\.ts$',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
      },
    },
  },
};
