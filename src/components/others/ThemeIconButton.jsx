"use client";

/**
 * Borderless theme switch: moon in light mode, sun in dark mode.
 * Lives inside the site footer so page headers stay quiet.
 */
import { useEffect, useState } from "react";
import { useTheme } from "@/components/contexts/ThemeProviderLite";

export default function ThemeIconButton({ className = "" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "切换到日间模式" : "切换到夜间模式";

  return (
    <button
      type="button"
      className={"site-theme-icon" + (className ? " " + className : "")}
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
      suppressHydrationWarning
    >
      {dark ? (
        // sun
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M12 2.6v2.2M12 19.2v2.2M4.6 12H2.4M21.6 12h-2.2M5.8 5.8 4.2 4.2M19.8 19.8l-1.6-1.6M18.2 5.8l1.6-1.6M4.2 19.8l1.6-1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // moon
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
