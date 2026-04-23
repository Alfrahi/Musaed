// Test comment to verify file is editable
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';

export default tseslint.config(
  // Ignore patterns
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/out/**', '**/coverage/**'],
  },

  // Next.js config (must come first to set up parser correctly)
  ...next,

  // Base TypeScript config with React, react-hooks, and jsx-a11y
  ...tseslint.configs.recommended,

  // TypeScript-specific rules
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'warn',
      '@next/next/no-assign-module-variable': 'off',
    },
  },

  // Test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
  },
);