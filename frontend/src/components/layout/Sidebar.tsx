import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, ScanEye, Clock, LogOut, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";

const nav = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/analysis",  icon: ScanEye,         label: "Análisis"  },
  { to: "/history",   icon: Clock,           label: "Historial" },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={cn(
      "relative flex flex-col h-screen bg-card border-r border-border transition-all duration-300 shrink-0",
      collapsed ? "w-16" : "w-60"
    )}>
      {/* Logo */}
      <div className="flex items-center h-16 px-3 border-b border-border gap-2.5 overflow-hidden">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-500/15 shrink-0">
          <Eye className="h-4 w-4 text-sky-400" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold tracking-tight leading-none">RikunaLab</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Screening Retinal IA</p>
          </div>
        )}
      </div>

      {/* Botón toggle — flotante en el borde derecho del sidebar */}
      <button
        onClick={() => setCollapsed(p => !p)}
        className={cn(
          "absolute -right-3 top-[52px] z-10",
          "flex items-center justify-center",
          "w-6 h-6 rounded-full",
          "bg-card border border-border",
          "text-muted-foreground hover:text-foreground hover:bg-muted",
          "transition-all duration-200 shadow-sm"
        )}
        title={collapsed ? "Expandir menú" : "Colapsar menú"}
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3" />
          : <ChevronLeft  className="h-3 w-3" />
        }
      </button>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
              collapsed && "justify-center",
              isActive
                ? "bg-sky-500/10 text-sky-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-border">
        {!collapsed && user && (
          <div className="mb-2 px-2">
            <p className="text-xs font-medium truncate">{user.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user.role}</p>
          </div>
        )}
        <button
          onClick={() => { logout(); navigate("/login"); }}
          title={collapsed ? "Cerrar sesión" : undefined}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm",
            "text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors",
            collapsed && "justify-center"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  );
}
