import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { GlassSettingsProvider } from './lib/glass-settings.jsx';
import { ThemeProvider } from './lib/theme-settings.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <GlassSettingsProvider>
        <App />
      </GlassSettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);
