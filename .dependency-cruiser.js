// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'no-cross-feature-imports',
      comment: 'Import only from feature index.ts barrel',
      from: { path: '^apps/web/src/features/[^/]+/' },
      to: { path: '^apps/web/src/features/[^/]+/[^/]' },
      severity: 'error'
    },

    {
      name: 'no-direct-tauri',
      comment: 'Use src/lib/ipc.ts only',
      from: { path: '^apps/web/src' },
      to: { path: '^@tauri-apps' },
      severity: 'error'
    }
  ],

  options: {
    doNotFollow: ['node_modules', 'dist', 'out', '.next'],
    prefix: '.'
  }
};
