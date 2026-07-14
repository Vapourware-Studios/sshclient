import { useEffect, useState } from 'react';

export function useViewMode(key, defaultMode = 'grid') {
  const storageKey = `sshclient.view.${key}`;
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(storageKey) || defaultMode;
    } catch {
      return defaultMode;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, mode);
    } catch {}
  }, [mode, storageKey]);

  return [mode, setMode];
}
