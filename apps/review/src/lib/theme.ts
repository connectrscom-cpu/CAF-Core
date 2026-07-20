"use client";

import { useCallback, useEffect, useState } from "react";

export type CafTheme = "dark" | "light";

/** Shared with the Core admin shell so the embedded workbench follows the same theme. */
export const THEME_STORAGE_KEY = "caf-theme";

export function readStoredTheme(): CafTheme {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: CafTheme) {
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

/**
 * Follow theme changes made by other same-origin documents (admin shell ↔
 * embedded review iframe, other tabs). Mounted once in the app shell so it
 * works even when no sidebar/toggle is rendered (embed mode).
 */
export function useThemeStorageSync() {
  useEffect(() => {
    applyTheme(readStoredTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      applyTheme(e.newValue === "light" ? "light" : "dark");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

/**
 * Theme state synced with localStorage and other same-origin documents
 * (admin shell ↔ embedded review iframe, other tabs) via storage events.
 */
export function useCafTheme(): { theme: CafTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<CafTheme>("dark");

  useEffect(() => {
    setTheme(readStoredTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next: CafTheme = e.newValue === "light" ? "light" : "dark";
      setTheme(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: CafTheme = prev === "light" ? "dark" : "light";
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore private mode */
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
