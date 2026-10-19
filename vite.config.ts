import { defineConfig } from 'vitest/config';
import type { Connect, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Download managers (IDM etc.) hijack requests for *.bin URLs. The app requests *.cbin instead (src/core/idmSafeFetch.ts):
 * the dev and preview servers answer *.cbin with the matching *.bin file under a neutral content type, and the build
 * renames *.bin to *.cbin in the output so a plain static server works too.
 */
function idmSafeBinaries(): Plugin {
  let outDir = 'dist';
  const serveFrom = (roots: string[]): Connect.NextHandleFunction => (req, res, next) => {
    const path = decodeURIComponent((req.url ?? '').split(/[?#]/)[0]);
    if (!path.endsWith('.cbin')) return next();
    for (const root of roots) {
      for (const candidate of [path, path.slice(0, -'.cbin'.length) + '.bin']) {
        const file = join(root, candidate);
        if (!file.startsWith(root) || !existsSync(file)) continue;
        res.setHeader('Content-Type', 'application/x-cosmos-binary');
        res.setHeader('Content-Length', String(statSync(file).size));
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
        return;
      }
    }
    next();
  };
  const renameBins = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) renameBins(full);
      else if (entry.name.endsWith('.bin')) renameSync(full, full.slice(0, -'.bin'.length) + '.cbin');
    }
  };
  return {
    name: 'cosmos-idm-safe-binaries',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    configureServer(server) { server.middlewares.use(serveFrom([resolve(server.config.publicDir)])); },
    configurePreviewServer(server) { server.middlewares.use(serveFrom([outDir])); },
    closeBundle() { if (existsSync(outDir)) renameBins(outDir); },
  };
}

// Sandbox pages (sandbox/*.html) are served automatically by the dev server for
// isolated module development; only the main app is part of the production build.
export default defineConfig({
  plugins: [react(), idmSafeBinaries()],
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
