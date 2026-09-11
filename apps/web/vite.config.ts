import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FIXTURES = resolve(__dirname, '../../fixtures');

/**
 * Dev-only: serve `fixtures/` at `/__fixtures/<name>` so `?fixture=<name>` opens a file
 * without a drag-drop. Read-only; never touches the fixture bytes.
 */
function fixtureServer(): Plugin {
  return {
    name: 'redline-fixture-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // POST /__fixtures/out/<name>: the demo's Save also drops a copy in fixtures/out/browser/.
        if (req.method === 'POST' && req.url?.startsWith('/__fixtures/out/')) {
          const name = decodeURIComponent(req.url.slice('/__fixtures/out/'.length)).replace(
            /[\\/]/g,
            '_',
          );
          const dir = join(FIXTURES, 'out', 'browser');
          mkdirSync(dir, { recursive: true });
          const out = createWriteStream(join(dir, name));
          req.pipe(out).on('finish', () => {
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        if (!req.url?.startsWith('/__fixtures/')) return next();
        const name = decodeURIComponent(req.url.slice('/__fixtures/'.length).split('?')[0] ?? '');
        if (name === '') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify([]));
          return;
        }
        const path = join(FIXTURES, name);
        if (!path.startsWith(FIXTURES) || !existsSync(path) || !statSync(path).isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('content-type', 'application/pdf');
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    fixtureServer(),
    // Installable and works offline on a job site: the shell, pdf.js and qpdf are
    // precached; documents never leave the browser anyway.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Redline',
        short_name: 'Redline',
        description: 'Browser-native PDF markup and measurement for construction plans',
        theme_color: '#d32f2f',
        background_color: '#f7f7f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg,woff2,mjs}'],
        // pdf.js and the qpdf WASM are each over the 2 MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
  optimizeDeps: {
    // pdf.js ships ESM with top-level await; keep it out of the pre-bundler.
    exclude: ['pdfjs-dist'],
  },
  build: {
    target: 'es2022',
  },
});
