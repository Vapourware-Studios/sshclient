// ============================================================================
// vite.config.mjs — VITE'S SETTINGS
// ============================================================================
// Vite is the "build tool": it turns modern source code (JSX, Tailwind
// classes, imports) into plain HTML/CSS/JS that Electron's window can load.
//
// Two ways we use it:
//   npm run dev   → Vite runs a live server; edits appear instantly (HMR)
//   npm run build → Vite writes final files into dist/renderer/
// ============================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In this file style (ESM), __dirname doesn't exist — we rebuild it:
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A tiny Vite plugin of our own. Content-Security-Policy ("only run code
// that came from our own files") is defense-in-depth we want in the finished
// app — but it would break dev mode, where Vite injects live-reload code.
// So: `apply: 'build'` adds the <meta> tag ONLY to production builds.
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
  // The renderer folder is the "website root" Vite serves and builds.
  root: 'src/renderer',

  // './' makes built asset paths relative, so Electron can load the files
  // straight from disk (file://) without a web server.
  base: './',

  plugins: [react(), tailwindcss(), cspOnBuild],

  resolve: {
    alias: {
      // '@/...' becomes 'src/renderer/...' — shadcn/ui components import
      // from '@/lib/utils' etc., and this line makes that work.
      '@': path.resolve(__dirname, 'src', 'renderer'),
    },
  },

  build: {
    outDir: path.resolve(__dirname, 'dist', 'renderer'),
    emptyOutDir: true,
  },
});
