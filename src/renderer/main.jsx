import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { GlassSettingsProvider } from './lib/glass-settings.jsx';
import { ThemeProvider } from './lib/theme-settings.jsx';
import { ConfirmProvider } from './lib/confirm.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <GlassSettingsProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </GlassSettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);
