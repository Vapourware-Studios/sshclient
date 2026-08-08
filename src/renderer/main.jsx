import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { GlassSettingsProvider } from './lib/glass-settings.jsx';
import { ThemeProvider } from './lib/theme-settings.jsx';
import { ConfirmProvider } from './lib/confirm.jsx';
import { PrivacySettingsProvider } from './lib/privacy-settings.jsx';
import { SharingProvider } from './lib/sharing.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <GlassSettingsProvider>
        <PrivacySettingsProvider>
          <ConfirmProvider>
            <SharingProvider>
              <App />
            </SharingProvider>
          </ConfirmProvider>
        </PrivacySettingsProvider>
      </GlassSettingsProvider>
    </ThemeProvider>
  </React.StrictMode>
);
