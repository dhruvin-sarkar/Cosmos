import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Sandbox pages (sandbox/*.html) are served automatically by the dev server for
// isolated module development; only the main app is part of the production build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Raw archive downloads and scratch output churn constantly during ingestion; watching them only causes reload storms.
    watch: { ignored: ['**/data-raw/**', '**/.shots/**', '**/.bench/**', '**/.work/**', '**/.remember/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html') },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
