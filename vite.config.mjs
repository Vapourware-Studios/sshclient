import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cspOnBuild = {
  name: 'inject-csp-on-build',
  apply: 'build',
  transformIndexHtml() {
    return [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content:
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        },
        injectTo: 'head-prepend',
      },
    ];
  },
};

export default defineConfig({
  root: 'src/renderer',
  base: './',
  // The main process and `wait-on` both hardcode this port. Without
  // strictPort an occupied 5173 sends Vite quietly to 5174 while Electron
  // keeps loading 5173 — a blank window with nothing to say why. Fail here
  // instead, where the message names the problem.
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [react(), tailwindcss(), cspOnBuild],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src', 'renderer'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
  },
});
