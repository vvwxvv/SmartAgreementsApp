"use client";

/**
 * A very small replacement for `next-themes`.
 *
 * Why: next-themes renders a `<script>` inside the provider tree, and React 19
 * (Next 16) warns about that on every client render — "Encountered a script tag
 * while rendering React component". We only need light/dark on <html>, so the
 * whole library is 60 lines here and the pre-paint script lives in the layout's
 * <head> instead of inside a component.
 *
 * API matches the bits we actually use: { theme, resolvedTheme, setTheme }.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext({
  theme: "light",
  resolvedTheme: "light",
  systemTheme: undefined,
  setTheme: () => {},
});

/** Put the theme on <html> + keep the two CSS variables the shell relies on. */
export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  const dark = theme === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.style.setProperty("--background-primary", dark ? "#000000" : "#ffffff");
  root.style.setProperty("--text-primary", dark ? "#ffffff" : "#000000");
}

export function ThemeProviderLite({ children, defaultTheme = "light", storageKey = "theme" }) {
  const [theme, setThemeState] = useState(defaultTheme);

  // Adopt whatever the pre-paint script already decided (no flash, no guess).
  useEffect(() => {
    let stored = defaultTheme;
    try {
      stored = localStorage.getItem(storageKey) || defaultTheme;
    } catch {
      stored = defaultTheme;
    }
    setThemeState(stored);
    applyTheme(stored);

    const onStorage = (e) => {
      if (e.key !== storageKey) return;
      const next = e.newValue || defaultTheme;
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [defaultTheme, storageKey]);

  const setTheme = useCallback(
    (next) => {
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* storage blocked: the class change still applies for this session */
      }
      applyTheme(next);
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme: theme, systemTheme: undefined, setTheme }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
