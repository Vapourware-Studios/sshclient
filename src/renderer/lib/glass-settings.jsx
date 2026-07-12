import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'sshclient.glassSettings';
const IS_MAC = window.api?.platform === 'darwin';
const DEFAULTS = { enabled: IS_MAC, intensity: 50 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      enabled: IS_MAC && (typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled),
      intensity: typeof parsed.intensity === 'number' ? parsed.intensity : DEFAULTS.intensity,
    };
  } catch {
    return DEFAULTS;
  }
}

const GlassSettingsContext = createContext(null);

export function GlassSettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const bgAlpha = glassAlpha(settings.enabled, settings.intensity, 1, 0.25);
    document.documentElement.style.setProperty('--glass-bg-alpha', `${bgAlpha * 100}%`);
  }, [settings]);

  const setEnabled = (enabled) => setSettings((prev) => ({ ...prev, enabled: IS_MAC && enabled }));
  const setIntensity = (intensity) => setSettings((prev) => ({ ...prev, intensity }));

  return (
    <GlassSettingsContext.Provider value={{ ...settings, setEnabled, setIntensity }}>
      {children}
    </GlassSettingsContext.Provider>
  );
}

export function useGlassSettings() {
  const ctx = useContext(GlassSettingsContext);
  if (!ctx) throw new Error('useGlassSettings must be used within GlassSettingsProvider');
  return ctx;
}

export function glassAlpha(enabled, intensity, opaqueAlpha, glassyAlpha) {
  if (!enabled) return opaqueAlpha;
  const t = Math.min(100, Math.max(0, intensity)) / 100;
  return opaqueAlpha + t * (glassyAlpha - opaqueAlpha);
}
