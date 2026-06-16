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
    setupFiles: ['./src/test/setup.ts', './vitest.setup.ts'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@musaed/contracts/migrations': path.resolve(
        __dirname,
        '../../packages/contracts/src/migrations'
      ),
      '@musaed/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/setup.ts'],
    },
  },
});
