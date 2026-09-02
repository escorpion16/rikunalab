import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "../lib/utils";

export function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [email, setEmail]       = useState("doctor@rikunalab.ai");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    const ok = await login(email, password);
    setLoading(false);
    if (ok) navigate("/dashboard");
    else setError("Credenciales incorrectas.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-sky-500/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full bg-violet-500/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 mb-4">
            <Eye className="h-7 w-7 text-sky-400" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">RikunaLab</h1>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="text-sky-400/80">Rikuna</span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Plataforma de Screening Retinal con IA</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl">
          <h2 className="text-sm font-semibold mb-4">Acceso al sistema</h2>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Correo</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                  required />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full h-9 pl-8 pr-9 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
                  required />
                <button type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg">{error}</p>}

            <button type="submit" disabled={loading}
              className={cn("w-full h-9 rounded-lg text-sm font-semibold transition-all",
                loading ? "bg-muted text-muted-foreground" : "bg-sky-500 hover:bg-sky-400 text-white"
              )}>
              {loading ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Verificando...</span> : "Ingresar"}
            </button>
          </form>

          <div className="mt-4 p-2.5 rounded-lg bg-muted text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Demo:</span> doctor@rikunalab.ai
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-5">
          RikunaLab · Dennis Benavides
        </p>
      </div>
    </div>
  );
}
