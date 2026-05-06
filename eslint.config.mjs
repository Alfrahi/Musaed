// eslint.config.mjs (v4)
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import importPlugin from 'eslint-plugin-import';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      'src-tauri/**',
      'demo/**',
    ],
  },

  ...tseslint.configs.recommended,

  {
    plugins: {
      '@next/next': nextPlugin,
      import: importPlugin,
      'react-hooks': reactHooksPlugin,
      react: reactPlugin,
    },

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './apps/web/tsconfig.json',
          './packages/contracts/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },

    settings: {
      react: { version: 'detect' },
      next: { rootDir: ['apps/web/'] },
    },

    rules: {
      // ======================
      // NEXT + REACT BASE
      // ======================
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,

      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      'react/function-component-definition': [
        'error',
        { namedComponents: 'arrow-function' },
      ],

      // ======================
      // TYPESCRIPT STRICTNESS
      // ======================
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // ======================
      // MUSAED v4 ENFORCEMENT LAYER
      // ======================
      'no-restricted-syntax': [
        'error',

        // SSR FORBIDDEN
        {
          selector:
          "ExportNamedDeclaration[declaration.declarations.0.id.name='getServerSideProps']",
          message: 'Musaed is fully static. SSR is forbidden.',
        },

        // RAW IPC FORBIDDEN
        {
          selector: "CallExpression[callee.name='invoke']",
          message: 'Direct invoke() is forbidden. Use src/lib/ipc.ts only.',
        },

        // DIRECT TAURI ACCESS FORBIDDEN
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/api/]",
          message: 'Direct Tauri API usage forbidden. Use IPC bridge only.',
        },

        // AI TOOLING DRIFT PREVENTION
        {
          selector:
          "Literal[value=/.*(webpack|vite|rollup|esbuild|turbo).*config.*/i]",
                               message: 'Do not introduce new tooling/configs without explicit approval.',
        },

        // PROCESS ENV ABSTRACTION ENFORCEMENT
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Use typed configuration layer instead of process.env directly.',
        },

        // LOGICAL PROPERTIES (from v2)
        {
          selector: 'Literal[value=/^(ml|mr|left|right|padding-left|padding-right)-/]',
                               message: 'Use logical properties: ms-*, me-*, ps-*, pe-*, inset-inline-*',
        },
      ],

      // ======================
      // ARCHITECTURE RULES
      // ======================
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*/*', '@/features/*/*'],
              message: 'Feature internals are private. Import only from feature index.ts',
            },
            {
              group: ['**/features/*/src/**'],
              message: 'Cross-feature internal access is forbidden (DDD violation).',
            },
          ],
        },
      ],

      // ======================
      // COMPLEXITY & CODE QUALITY
      // ======================
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
      'prefer-const': 'error',
      'no-else-return': 'error',
      'no-useless-return': 'error',

      // ======================
      // MUSAED SPECIFIC
      // ======================
      'no-restricted-properties': [
        'error',
        { object: 'console', property: 'log', message: 'Use structured logger' },
      ],
    },
  },

  // ======================
  // EXCEPTIONS
  // ======================

  {
    files: ['apps/web/src/lib/ipc.ts', 'apps/web/src/lib/tauri-storage.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  {
    files: [
      '**/*.{test,spec}.ts',
      '**/*.{test,spec}.tsx',
      'apps/web/src/test/**/*',
      'apps/web/src/tests/**/*',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'max-lines-per-function': 'off',
    },
  },

  {
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
    languageOptions: { parserOptions: { project: null } },
  }
);
