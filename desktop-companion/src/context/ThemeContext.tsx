import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeContextType {
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  /** Flip between light and dark (leaves "system" the moment the user picks a side). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);
const STORAGE_KEY = "karsa_theme_mode";

const readStored = (): ThemeMode => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch (_) {}
  return "system";
};

/**
 * Single owner of the theme. It writes `data-theme` and the `.dark` class on <html>, which swaps the CSS variables
 * in index.css for every surface at once. The choice is kept in localStorage (instant on load) and in the SQLite
 * `system_settings` table (`ui.theme`, via /api/v1/settings/theme).
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStored);
  const [systemIsDark, setSystemIsDark] = useState(() =>
    window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : true
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const isDark = themeMode === "dark" || (themeMode === "system" && systemIsDark);

  // Apply to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", isDark ? "dark" : "light");
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);

  // Reconcile with the value saved in SQLite once (the database wins when it has an explicit choice)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/settings/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        if ((d.mode === "light" || d.mode === "dark") && d.mode !== themeMode) {
          setThemeModeState(d.mode);
          try {
            localStorage.setItem(STORAGE_KEY, d.mode);
          } catch (_) {}
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (_) {}
    fetch("/api/v1/settings/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => setThemeMode(isDark ? "light" : "dark"), [isDark, setThemeMode]);

  const value = useMemo(
    () => ({ themeMode, isDark, setThemeMode, toggleTheme }),
    [themeMode, isDark, setThemeMode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
};

/** ☀️ / 🌙 button used in the notch bar and the dock header. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Ganti ke Light Mode" : "Ganti ke Dark Mode"}
      aria-label={isDark ? "Ganti ke Light Mode" : "Ganti ke Dark Mode"}
      className={`h-6 px-1.5 rounded-full bg-pill text-ink text-[11px] font-semibold flex items-center gap-1 cursor-pointer hover:brightness-110 active:scale-95 transition-all pointer-events-auto ${className}`}
    >
      <span aria-hidden="true">{isDark ? "🌙" : "☀️"}</span>
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
};
