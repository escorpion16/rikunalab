import { Sun, Moon } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLocation } from "react-router-dom";

const pages: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Dashboard",              subtitle: "Visión general del sistema" },
  "/analysis":  { title: "Análisis de Imagen",     subtitle: "Sube una imagen fundus para análisis" },
  "/history":   { title: "Historial",              subtitle: "Análisis anteriores" },
};

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const page = pages[pathname] ?? { title: "RikunaLab", subtitle: "" };
  return (
    <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 shrink-0">
      <div>
        <h1 className="text-sm font-semibold leading-none">{page.title}</h1>
        {page.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{page.subtitle}</p>}
      </div>
      <button onClick={toggleTheme}
        className="p-2 rounded-md text-muted-foreground hover:bg-muted transition-colors"
        title={theme === "dark" ? "Modo claro" : "Modo oscuro"}>
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}
