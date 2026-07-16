import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'sshclient.privacySettings';
const DEFAULTS = { blurHostIps: false };

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      blurHostIps:
        typeof parsed.blurHostIps === 'boolean' ? parsed.blurHostIps : DEFAULTS.blurHostIps,
    };
  } catch {
    return DEFAULTS;
  }
}

const PrivacySettingsContext = createContext(null);

export function PrivacySettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setBlurHostIps = (blurHostIps) => setSettings((prev) => ({ ...prev, blurHostIps }));

  return (
    <PrivacySettingsContext.Provider value={{ ...settings, setBlurHostIps }}>
      {children}
    </PrivacySettingsContext.Provider>
  );
}

export function usePrivacySettings() {
  const ctx = useContext(PrivacySettingsContext);
  if (!ctx) throw new Error('usePrivacySettings must be used within PrivacySettingsProvider');
  return ctx;
}
