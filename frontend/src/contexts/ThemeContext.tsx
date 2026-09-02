import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "dark" | "light";
interface ThemeCtx { theme: Theme; toggleTheme: () => void; }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("rikuna_theme") as Theme) || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    localStorage.setItem("rikuna_theme", theme);
  }, [theme]);
  const toggleTheme = () => setTheme(p => p === "dark" ? "light" : "dark");
  return <Ctx.Provider value={{ theme, toggleTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
