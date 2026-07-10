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
