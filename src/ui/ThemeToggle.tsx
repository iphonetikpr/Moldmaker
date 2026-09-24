import { useState } from "react";
import { applyTheme, persistTheme, readStoredTheme, toggleTheme, type Theme } from "../theme";

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M13.2 10.1A5.4 5.4 0 0 1 5.9 2.8 5.6 5.6 0 1 0 13.2 10.1Z" fill="currentColor" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = readStoredTheme();
    applyTheme(current);
    return current;
  });
  const next = toggleTheme(theme);

  return (
    <button
      type="button"
      className="ghost theme-toggle"
      onClick={() => {
        persistTheme(next);
        setTheme(next);
      }}
      aria-label={next === "light" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-pressed={theme === "light"}
      title={theme === "light" ? "Claro" : "Oscuro"}
    >
      {theme === "light" ? <SunIcon /> : <MoonIcon />}
      <span>{theme === "light" ? "Claro" : "Oscuro"}</span>
    </button>
  );
}
