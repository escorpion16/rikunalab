import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

interface User { email: string; name: string; role: string; }
const DEMO: User = { email: "doctor@rikunalab.ai", name: "Dr. Demo", role: "Médico General" };
const PASS = "demo2026";

interface AuthCtx { user: User | null; login: (e: string, p: string) => Promise<boolean>; logout: () => void; isAuthenticated: boolean; }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { const s = localStorage.getItem("rikuna_user"); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  const login = async (email: string, password: string) => {
    await new Promise(r => setTimeout(r, 700));
    if (email.toLowerCase() === DEMO.email && password === PASS) {
      setUser(DEMO); localStorage.setItem("rikuna_user", JSON.stringify(DEMO)); return true;
    }
    return false;
  };

  const logout = () => { setUser(null); localStorage.removeItem("rikuna_user"); };

  return <Ctx.Provider value={{ user, login, logout, isAuthenticated: !!user }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
export type { User };
