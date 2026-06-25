/** @type {import('dependency-cruiser').IConfiguration} */
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

    // ── 2. Cross-feature imports (DDD boundary) ─────────────
    // Each feature is isolated. Communication must go through IPC or shared lib.
    // Per-feature rules use negative lookahead to avoid same-feature false positives.
    {
      name: 'no-chat-to-other-features',
      comment: 'chat feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/conversation/' },
      to: { path: '^apps/web/src/features/(?!chat/)' },
      severity: 'error',
    },
    {
      name: 'no-info-to-other-features',
      comment: 'info feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/info/' },
      to: { path: '^apps/web/src/features/(?!info/)' },
      severity: 'error',
    },
    {
      name: 'no-layout-to-other-features',
      comment: 'layout feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/layout/' },
      to: { path: '^apps/web/src/features/(?!layout/)' },
      severity: 'error',
    },
    {
      name: 'no-library-to-other-features',
      comment: 'library feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/library/' },
      to: { path: '^apps/web/src/features/(?!library/)' },
      severity: 'error',
    },
    {
      name: 'no-rag-to-other-features',
      comment: 'rag feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/rag/' },
      to: { path: '^apps/web/src/features/(?!rag/)' },
      severity: 'error',
    },
    {
      name: 'no-settings-to-other-features',
      comment: 'settings feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/settings/' },
      to: { path: '^apps/web/src/features/(?!settings/)' },
      severity: 'error',
    },
    {
      name: 'no-sidebar-to-other-features',
      comment: 'sidebar feature must not import other features — use IPC or shared lib.',
      from: { path: '^apps/web/src/features/sidebar/' },
      to: { path: '^apps/web/src/features/(?!sidebar/)' },
      severity: 'error',
    },

    // ── 3. Feature internals only accessible via index.ts ────
    // Code outside a feature may only import its barrel (index.ts).
    {
      name: 'no-external-feature-internals',
      comment: 'Feature internals are private. Import only from feature barrel (index.ts).',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/' },
      to: {
        path: '^apps/web/src/features/[^/]+/',
        pathNot: '^apps/web/src/features/[^/]+/index\\.ts$',
      },
      severity: 'error',
    },

    // ── 4. Direct Tauri API access ───────────────────────────
    {
      name: 'no-direct-tauri-api',
      comment: 'Use src/lib/ipc.ts — direct @tauri-apps/api usage is forbidden.',
      from: {
        path: '^apps/web/src/',
        pathNot: [
          '^apps/web/src/lib/ipc\\.ts$',
          '^apps/web/src/lib/tauri-storage\\.ts$',
          '^apps/web/src/__mocks__/',
          '^apps/web/src/tests/',
          '^apps/web/src/.*\\.test\\.',
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
        path: '^apps/web/src/',
        pathNot: [
          '^apps/web/src/lib/ipc\\.ts$',
          '^apps/web/src/lib/tauri-storage\\.ts$',
          '^apps/web/src/__mocks__/',
          '^apps/web/src/tests/',
          '^apps/web/src/.*\\.test\\.',
        ],
      },
      to: { path: '^@tauri-apps/plugin-' },
      severity: 'error',
    },

    // ── 6. Store must not depend on features ────────────────
    {
      name: 'no-store-to-feature',
      comment: 'Stores are shared infrastructure — must not depend on feature internals.',
      from: { path: '^apps/web/src/store/' },
      to: { path: '^apps/web/src/features/' },
      severity: 'error',
    },

    // ── 7. lib/ must not depend on features ──────────────────
    {
      name: 'no-lib-to-feature',
      comment: 'lib/ is shared infrastructure — must not depend on features.',
      from: { path: '^apps/web/src/lib/' },
      to: { path: '^apps/web/src/features/' },
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
        'out',
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
