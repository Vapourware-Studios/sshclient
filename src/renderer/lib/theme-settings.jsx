import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'sshclient.theme';
const DEFAULTS = { isDark: true };

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { isDark: typeof parsed.isDark === 'boolean' ? parsed.isDark : DEFAULTS.isDark };
  } catch {
    return DEFAULTS;
  }
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.classList.toggle('dark', settings.isDark);
  }, [settings]);

  const setIsDark = (isDark) => setSettings({ isDark });

  return (
    <ThemeContext.Provider value={{ ...settings, setIsDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
