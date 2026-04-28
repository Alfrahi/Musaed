/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-feature-internals',
      comment: 'Feature internals are private. Only import from the feature barrel file (index.ts).',
      severity: 'error',
      from: { path: 'apps/web/src/features/([^/]+)/.+' },
      to: {
        path: 'apps/web/src/features/([^/]+)/.+',
        pathNot: [
          'apps/web/src/features/$1/.+',
          'apps/web/src/features/[^/]+/index.ts'
        ]
      }
    },
    {
      name: 'ipc-only-system-access',
      comment: 'Components should not access system APIs directly. Use src/lib/ipc.ts.',
      severity: 'error',
      from: { path: 'apps/web/src/features' },
      to: {
        path: '@tauri-apps/api/.+',
        pathNot: 'apps/web/src/lib/ipc.ts'
      }
    },
    {
      name: 'no-circular-dependencies',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'domain-layer-isolation',
      comment: 'The contracts package should be the source of truth for types. Features should not depend on other features for models/types.',
      severity: 'error',
      from: { path: 'apps/web/src/features/([^/]+)/.+' },
      to: {
        path: 'apps/web/src/features/([^/]+)/types/.+',
        pathNot: 'apps/web/src/features/$1/.+'
      }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules'
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'apps/web/tsconfig.json'
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "module", "types"]
    }
  }
};
