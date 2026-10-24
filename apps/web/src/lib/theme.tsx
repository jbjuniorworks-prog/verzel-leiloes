import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'martelo-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

const ThemeContext = createContext<{ preference: ThemePreference; isDark: boolean; cycle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  const isDark = preference === 'dark' || (preference === 'system' && systemDark);

  useEffect(() => {
    const query = media();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next: ThemePreference = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
      try {
        if (next === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Armazenamento bloqueado: o tema vale só para esta sessão.
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ preference, isDark, cycle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme fora do ThemeProvider');
  return context;
}
