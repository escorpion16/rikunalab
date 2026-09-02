import { useNavigate } from "react-router-dom";
import { ScanEye, Activity, TrendingUp, Eye, Clock, ChevronRight, CheckCircle, AlertTriangle } from "lucide-react";
import { useHistory } from "../contexts/HistoryContext";
import { useAuth } from "../contexts/AuthContext";
import { formatDate, getRiskLabel, getModuleLabel, getModuleBadgeBg, cn } from "../lib/utils";

export function DashboardPage() {
  const navigate  = useNavigate();
  const { history } = useHistory();
  const { user }    = useAuth();

  const totalAnalyses  = history.length;
  const glaucomaCount  = history.filter(r => r.module === "glaucoma").length;
  const drCount        = history.filter(r => r.module === "dr").length;
  const highRiskCount  = history.filter(r => r.riskLevel === "high").length;
  const recent         = history.slice(0, 6);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Bienvenida */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Bienvenido, {user?.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{user?.role} · Sistema activo</p>
        </div>
        <button onClick={() => navigate("/analysis")}
          className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-sm font-medium transition-colors">
          <ScanEye className="h-4 w-4" />Nuevo análisis
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Análisis totales", value: totalAnalyses, icon: Activity,     color: "text-sky-400",    bg: "bg-sky-500/10" },
          { label: "Glaucoma",         value: glaucomaCount, icon: Eye,          color: "text-sky-400",    bg: "bg-sky-500/10" },
          { label: "Ret. Diabética",   value: drCount,       icon: Activity,     color: "text-violet-400", bg: "bg-violet-500/10" },
          { label: "Alto Riesgo",      value: highRiskCount, icon: AlertTriangle, color: "text-rose-400",  bg: "bg-rose-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</p>
              </div>
              <div className={`p-2 rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Módulos */}
      <div className="grid lg:grid-cols-2 gap-4">
        {([
          {
            module: "glaucoma" as const,
            auroc: "94.38%", sens: "86.75%", spec: "88.83%",
            dataset: "AIROGS-light-v2", images: "8,000",
            desc: "Detección de signos de glaucoma mediante análisis del nervio óptico en imágenes fundus."
          },
          {
            module: "dr" as const,
            auroc: "98.25%", sens: "96.64%", spec: "94.95%",
            dataset: "APTOS 2019", images: "2,929",
            desc: "Clasificación de retinopatía diabética referible vs no referible para derivación oportuna."
          }
        ]).map(({ module, auroc, sens, spec, dataset, images, desc }) => (
          <div key={module} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className={cn("text-xs font-medium px-2 py-1 rounded-md border", getModuleBadgeBg(module))}>
                {getModuleLabel(module)}
              </span>
              <span className="text-xs text-muted-foreground">EfficientNet-B3</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{desc}</p>
            <div className="space-y-2">
              {[["AUROC", auroc], ["Sensibilidad", sens], ["Especificidad", spec]].map(([l, v]) => (
                <div key={l}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full rounded-full", module === "glaucoma" ? "bg-sky-500" : "bg-violet-500")}
                      style={{ width: v }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-[11px] text-muted-foreground">{dataset} · {images} imágenes</span>
              <button onClick={() => navigate("/analysis")}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                Analizar <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Estado del sistema */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
        <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
        <div>
          <p className="text-xs font-medium text-emerald-400">Sistema operativo</p>
          <p className="text-[11px] text-muted-foreground">Backend FastAPI · PyTorch CUDA · 2 módulos activos</p>
        </div>
      </div>

      {/* Historial reciente */}
      {recent.length > 0 && (
        <div className="bg-card border border-border rounded-xl">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Análisis recientes</span>
            </div>
            <button onClick={() => navigate("/history")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              Ver todos <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-border">
            {recent.map(r => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className={cn("w-1.5 h-8 rounded-full",
                    r.riskLevel === "low" ? "bg-emerald-400" : r.riskLevel === "medium" ? "bg-amber-400" : "bg-rose-400"
                  )} />
                  <div>
                    <p className="text-xs font-medium truncate max-w-[180px]">{r.filename}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(r.timestamp)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", getModuleBadgeBg(r.module))}>
                    {r.module === "glaucoma" ? "GL" : "DR"}
                  </span>
                  <span className={cn("text-xs font-bold tabular-nums",
                    r.riskLevel === "low" ? "text-emerald-400" : r.riskLevel === "medium" ? "text-amber-400" : "text-rose-400"
                  )}>
                    {(r.riskScore * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
