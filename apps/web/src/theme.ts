import { useEffect, useState } from "react";

const THEME_KEY = "revexec.theme";
export type Theme = "light" | "dark";

export function readStoredTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) ?? "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")) };
}
