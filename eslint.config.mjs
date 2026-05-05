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

  // ----------------------------
  // Base TypeScript + Recommended Rules
  // ----------------------------
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
      react: {
        version: 'detect',
      },
      next: {
        rootDir: ['apps/web/'],
      },
    },

    rules: {
      // Next.js
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,

      // React
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,

      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // MUSAED Core Rules
      'no-restricted-syntax': [
        'error',
        {
          selector: "ExportNamedDeclaration[declaration.declarations.0.id.name='getServerSideProps']",
          message: 'Musaed is fully static (offline). SSR is forbidden.',
        },
        {
          selector: "CallExpression[callee.name='invoke']",
          message: 'Direct Tauri invoke() is forbidden. Use src/lib/ipc.ts instead.',
        },
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/api/]",
          message: 'Direct Tauri API imports are forbidden. Use IPC bridge only.',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],

      'react/function-component-definition': ['error', { namedComponents: 'arrow-function' }],

      'max-lines-per-function': [
        'error',
        { max: 100, skipBlankLines: true, skipComments: true },
      ],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*/*'],
              message: 'Feature internals are private. Import only from feature index.ts',
            },
            {
              group: ['@/features/*/*'],
              message: 'Feature internals are private. Import only from feature index.ts',
            },
          ],
        },
      ],
    },
  },

  // ======================
  // EXCEPTIONS
  // ======================

  // IPC & Storage files - allow direct Tauri usage
  {
    files: ['apps/web/src/lib/ipc.ts', 'apps/web/src/lib/tauri-storage.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // Test files - more lenient + disable TS project checking for .js files
  {
    files: [
      '**/*.{test,spec}.ts',
      '**/*.{test,spec}.tsx',
      'apps/web/src/test/**/*',
      'apps/web/src/tests/**/*',
      'apps/web/vitest.config.ts',
      'apps/web/vitest.integration.config.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react/function-component-definition': 'off',
      'max-lines-per-function': 'off',
    },
  },

  // Disable TypeScript project parser for plain .js test files
  {
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  }
);
