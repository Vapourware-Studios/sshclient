// ============================================================================
// main.jsx — WHERE REACT TAKES OVER
// ============================================================================
// (Don't confuse with src/main/main.js — that's Electron's main process.
//  This file runs in the renderer, i.e. inside the window.)
//
// It does exactly one job: find <div id="root"> in index.html and hand it
// to React. From then on, React owns everything inside that div, and our
// whole UI is described by components (see App.jsx).
// ============================================================================
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // Tailwind + the shadcn/ui theme, applied app-wide

createRoot(document.getElementById('root')).render(
  // StrictMode adds extra development-only checks. It renders nothing.
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
