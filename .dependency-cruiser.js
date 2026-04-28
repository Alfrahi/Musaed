/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-feature-internals',
      comment: 'Feature internals are private. Only import from the feature barrel file (index.ts).',
      severity: 'error',
      from: { path: 'src/features/([^/]+)/.+' },
      to: {
        path: 'src/features/([^/]+)/.+',
        pathNot: [
          'src/features/$1/.+',
          'src/features/[^/]+/index.ts'
        ]
      }
    },
    {
      name: 'ipc-only-system-access',
      comment: 'Components should not access system APIs directly. Use src/lib/ipc.ts.',
      severity: 'error',
      from: { path: 'src/features' },
      to: {
        path: '@tauri-apps/api/.+',
        pathNot: 'src/lib/ipc.ts'
      }
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json'
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "module", "types"]
    }
  }
};
