import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Runs slower or environment-specific tests when you add `*.integration.test.ts` files. */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['**/*.integration.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@musaed/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
  },
});
