import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../packages/contracts/src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts', './vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@musaed/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/tests/setup.ts'],
      // Ratchet up as coverage improves. Baseline (2026-09): ~70% stmts,
      // ~64% branch, ~63% funcs, ~72% lines. Thresholds sit below baseline to
      // avoid flaky CI while still catching a wholesale coverage collapse.
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 55,
        lines: 65,
      },
    },
  },
});
