import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getTheme, themeCssText, xtermThemeFor } from './terminal-themes';

const STORAGE_KEY = 'sshclient.theme';
const DEFAULTS = { themeId: 'default-dark', customCss: '', customCssName: '' };

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);

    // Older versions stored a dark-mode boolean plus a 'default' theme id —
    // fold both into the two built-in styles.
    let themeId = typeof parsed.themeId === 'string' ? parsed.themeId : DEFAULTS.themeId;
    if (themeId === 'default') themeId = parsed.isDark === false ? 'default-light' : 'default-dark';
    if (!getTheme(themeId)) themeId = DEFAULTS.themeId;

    return {
      themeId,
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : DEFAULTS.customCss,
      customCssName:
        typeof parsed.customCssName === 'string' ? parsed.customCssName : DEFAULTS.customCssName,
    };
  } catch {
    return DEFAULTS;
  }
}

// Adopted stylesheets sit after index.css in the cascade, so style tokens
// and user CSS override the built-in theme without touching the DOM. The
// custom sheet comes last: user CSS always wins over the selected style.
const templateSheet = new CSSStyleSheet();
const customSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, templateSheet, customSheet];

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings);

  const activeTheme = getTheme(settings.themeId) ?? getTheme(DEFAULTS.themeId);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    document.documentElement.classList.toggle('dark', activeTheme.dark);

    try {
      templateSheet.replaceSync(activeTheme.builtin ? '' : themeCssText(activeTheme));
    } catch {
      templateSheet.replaceSync('');
    }
    try {
      customSheet.replaceSync(settings.customCss || '');
    } catch {
      // Broken user CSS shouldn't take the app down — drop it silently.
      customSheet.replaceSync('');
    }
  }, [settings, activeTheme]);

  const setThemeId = (themeId) => setSettings((prev) => ({ ...prev, themeId }));
  const setCustomCss = (customCss, customCssName = '') =>
    setSettings((prev) => ({ ...prev, customCss, customCssName }));

  const terminalTheme = useMemo(() => xtermThemeFor(activeTheme), [activeTheme]);

  return (
    <ThemeContext.Provider
      value={{ ...settings, activeTheme, terminalTheme, setThemeId, setCustomCss }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
