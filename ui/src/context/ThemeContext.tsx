import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "papierklammer" | "violet-indigo" | "earth";

export const THEMES: readonly Theme[] = ["papierklammer", "violet-indigo", "earth"] as const;

export const THEME_LABELS: Record<Theme, string> = {
  papierklammer: "PAPIERKLAMMER",
  "violet-indigo": "VIOLET-INDIGO",
  earth: "EARTH",
};

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const THEME_STORAGE_KEY = "papierklammer-theme";
const DEFAULT_THEME: Theme = "papierklammer";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isValidTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  const setTheme = useCallback((nextTheme: Theme) => {
    if (!isValidTheme(nextTheme)) return;
    setThemeState(nextTheme);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore local storage write failures in restricted environments.
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
