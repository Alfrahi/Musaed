// eslint.config.mjs — Musaed v3 Enforcement Layer
// Flat config (ESLint 9+). Rules are partitioned by concern:
//   ESLint        → code quality, TypeScript strictness, React/Next best practices
//   dep-cruiser   → architecture boundaries, feature isolation, import graph
//   Husky         → local guardrail orchestration
//   CI            → full validation gate

import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────
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

  // ── Base: TypeScript recommended ─────────────────────────
  ...tseslint.configs.recommended,

  // ── Main config ─────────────────────────────────────────
  {
    plugins: {
      '@next/next': nextPlugin,
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
      // ================================================
      // NEXT + REACT
      // ================================================
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

      // Next.js App Router — no pages/ directory
      '@next/next/no-html-link-for-pages': 'off',

      // ================================================
      // TYPESCRIPT STRICTNESS
      // ================================================
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',

      // ================================================
      // MUSAED RUNTIME ENFORCEMENT (no-restricted-syntax)
      // Architecture boundary rules live in .dependency-cruiser.js
      // ================================================
      'no-restricted-syntax': [
        'error',

        // SSR FORBIDDEN — Musaed is static-export only
        {
          selector:
            "ExportNamedDeclaration[declaration.declarations.0.id.name='getServerSideProps']",
          message: 'Musaed is fully static. getServerSideProps is forbidden.',
        },
        {
          selector:
            "ExportNamedDeclaration[declaration.declarations.0.id.name='getStaticProps']",
          message: 'Musaed uses static export. getStaticProps is forbidden — use client-side data fetching.',
        },

        // RAW IPC FORBIDDEN — must use src/lib/ipc.ts
        {
          selector: "CallExpression[callee.name='invoke']",
          message: 'Direct invoke() is forbidden. Use src/lib/ipc.ts only.',
        },

        // WINDOW.__TAURI__ GLOBAL FORBIDDEN
        {
          selector: "MemberExpression[object.name='window'][property.name='__TAURI__']",
          message: 'Direct window.__TAURI__ access is forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // WINDOW.__TAURI_INTERNALS__ GLOBAL FORBIDDEN
        {
          selector: "MemberExpression[object.name='window'][property.name='__TAURI_INTERNALS__']",
          message: 'Direct window.__TAURI_INTERNALS__ access is forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // DIRECT TAURI API FORBIDDEN
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/api/]",
          message: 'Direct Tauri API usage forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // DIRECT TAURI PLUGIN FORBIDDEN
        {
          selector: "ImportDeclaration[source.value=/^@tauri-apps\\/plugin-/]",
          message: 'Direct Tauri plugin usage forbidden. Use IPC bridge (src/lib/ipc.ts) only.',
        },

        // AI TOOLING DRIFT PREVENTION
        {
          selector:
            "Literal[value=/.*(webpack|vite|rollup|esbuild|turbo).*config.*/i]",
          message: 'Do not introduce new tooling/configs without explicit approval.',
        },

        // PROCESS.ENV ABSTRACTION
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Use typed configuration layer instead of process.env directly.',
        },
      ],

      // ================================================
      // COMPLEXITY & CODE QUALITY
      // ================================================
      'max-lines-per-function': [
        'error',
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      'prefer-const': 'error',
      'no-else-return': 'error',
      'no-useless-return': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // ================================================
      // MUSAED-SPECIFIC
      // ================================================
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          property: 'log',
          message: 'Use structured logger (src/lib/logger.ts).',
        },
      ],
    },
  },

  // ── IPC layer exceptions ─────────────────────────────────
  {
    files: [
      'apps/web/src/lib/ipc.ts',
      'apps/web/src/lib/tauri-storage.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Test file exceptions ─────────────────────────────────
  {
    files: [
      '**/*.{test,spec}.ts',
      '**/*.{test,spec}.tsx',
      'apps/web/src/tests/**/*',
      'apps/web/src/__mocks__/**/*',
    ],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'max-lines-per-function': 'off',
      'no-restricted-properties': 'off',
      'no-console': 'off',
    },
  },

  // ── Config/JS file exceptions ────────────────────────────
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
    },
    languageOptions: { parserOptions: { project: null } },
  },

  // ── Vitest config exception ──────────────────────────────
  {
    files: ['**/vitest*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Playwright config exception ─────────────────────────
  {
    files: ['**/playwright*.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // ── Config layer exception ──────────────────────────────
  {
    files: ['apps/web/src/lib/config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
