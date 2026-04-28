import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import importPlugin from 'eslint-plugin-import';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**', '**/coverage/**', 'src-tauri/**', 'demo/**'],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@next/next': nextPlugin,
      'import': importPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./apps/web/tsconfig.json', './packages/contracts/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,

      // 🚀 Musaed Engineering Standards Enforcement

      // 1. Core Principles: No SSR & IPC Only
      '@next/next/no-server-import-in-page': 'error',
      'no-restricted-syntax': [
        {
          selector: "ExportNamedDeclaration[declaration.declarations.0.id.name='getServerSideProps']",
          message: 'Musaed is 100% offline. No SSR allowed (getServerSideProps is forbidden).',
        },
        {
          selector: "CallExpression[callee.name='invoke']",
          message: 'Direct Tauri invoke() calls are forbidden. Use the central IPC bridge in src/lib/ipc.ts.',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/\\b(ml-|mr-|pl-|pr-|left-|right-)/]",
          message: 'Use logical properties (ms-*, me-*, ps-*, pe-*) instead of physical ones (ml, mr, pl, pr, left, right).',
        },
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/api/]",
          message: 'Direct Tauri API imports are forbidden in features. Use the central IPC bridge in src/lib/ipc.ts.',
        }
      ],

      // 2. TypeScript & React: No "any"
      '@typescript-eslint/no-explicit-any': 'error',
      'react/function-component-definition': [
        'error',
        { namedComponents: 'arrow-function' },
      ],

      // 3. Code Quality: Function length
      'max-lines-per-function': ['error', { max: 70, skipBlankLines: true, skipComments: true }],

      // 4. Domain-Driven Structure: Barrel files & cross-feature boundaries
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/*/*', '!**/features/*/index'],
              message: 'Feature internals are private. Only import from the feature barrel file (index.ts).',
            },
            {
              group: ['@/features/*/*', '!@/features/*/index'],
              message: 'Feature internals are private. Only import from the feature barrel file (index.ts).',
            }
          ],
        },
      ],

      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/src/lib/ipc.ts', 'apps/web/src/lib/tauri-storage.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
