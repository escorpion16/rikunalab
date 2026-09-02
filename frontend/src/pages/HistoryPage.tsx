import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, ScanEye, Search, Clock, AlertTriangle, CheckCircle, Info, Eye } from "lucide-react";
import { useHistory } from "../contexts/HistoryContext";
import type { AnalysisResult, RiskLevel, ModuleType } from "../contexts/HistoryContext";
import { formatDate, getRiskLabel, getRiskColor, getModuleLabel, getModuleBadgeBg, cn } from "../lib/utils";

type FilterLevel  = "all" | RiskLevel;
type FilterModule = "all" | ModuleType;

export function HistoryPage() {
  const { history, deleteAnalysis, clearHistory } = useHistory();
  const navigate = useNavigate();
  const [search, setSearch]       = useState("");
  const [filterRisk, setFilterRisk]     = useState<FilterLevel>("all");
  const [filterModule, setFilterModule] = useState<FilterModule>("all");
  const [selectedId, setSelectedId]     = useState<string | null>(null);

  const filtered = history.filter(r =>
    r.filename.toLowerCase().includes(search.toLowerCase()) &&
    (filterRisk   === "all" || r.riskLevel === filterRisk) &&
    (filterModule === "all" || r.module    === filterModule)
  );
  const selected = history.find(r => r.id === selectedId) ?? null;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Controles */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 h-8 w-48 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
          </div>
          {/* Filtro módulo */}
          {(["all","glaucoma","dr"] as FilterModule[]).map(m => (
            <button key={m} onClick={() => setFilterModule(m)}
              className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                filterModule === m ? "bg-sky-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"
              )}>
              {m === "all" ? "Todos" : m === "glaucoma" ? "Glaucoma" : "Ret. Diabética"}
            </button>
          ))}
          {/* Filtro riesgo */}
          {(["all","high","medium","low"] as FilterLevel[]).map(l => (
            <button key={l} onClick={() => setFilterRisk(l)}
              className={cn("px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                filterRisk === l
                  ? l === "high" ? "bg-rose-500 text-white" : l === "medium" ? "bg-amber-500 text-white" : l === "low" ? "bg-emerald-500 text-white" : "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}>
              {l === "all" ? "Todos" : l === "high" ? "Alto" : l === "medium" ? "Moderado" : "Bajo"}
            </button>
          ))}
        </div>
        {history.length > 0 && (
          <button onClick={() => { if (confirm("¿Borrar todo el historial?")) { clearHistory(); setSelectedId(null); } }}
            className="flex items-center gap-1.5 text-xs text-rose-400 border border-rose-500/30 px-3 py-1.5 rounded-lg hover:bg-rose-500/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />Limpiar
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Clock className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm">{history.length === 0 ? "Sin análisis guardados" : "Sin resultados"}</p>
          {history.length === 0 && (
            <button onClick={() => navigate("/analysis")}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-lg text-sm font-medium transition-colors">
              <ScanEye className="h-4 w-4" />Realizar primer análisis
            </button>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4">
          {/* Lista */}
          <div className="lg:col-span-2 space-y-1.5">
            <p className="text-xs text-muted-foreground px-1">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</p>
            {filtered.map(r => (
              <div key={r.id} onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                className={cn("flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all",
                  selectedId === r.id ? "border-sky-500/50 bg-sky-500/5" : "border-border hover:bg-muted"
                )}>
                <div className="flex items-center gap-2.5 min-w-0">
                  {r.riskLevel === "high" ? <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    : r.riskLevel === "medium" ? <Info className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    : <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{r.filename}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn("text-[10px] px-1 py-0.5 rounded border", getModuleBadgeBg(r.module))}>
                        {r.module === "glaucoma" ? "GL" : "DR"}
                      </span>
                      <p className="text-[11px] text-muted-foreground">{formatDate(r.timestamp)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("text-xs font-bold tabular-nums",
                    r.riskLevel === "low" ? "text-emerald-400" : r.riskLevel === "medium" ? "text-amber-400" : "text-rose-400"
                  )}>{(r.riskScore * 100).toFixed(0)}%</span>
                  <button onClick={e => { e.stopPropagation(); deleteAnalysis(r.id); if (selectedId === r.id) setSelectedId(null); }}
                    className="p-1 text-muted-foreground hover:text-rose-400 transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Detalle */}
          <div className="lg:col-span-3">
            {selected ? <DetailPanel result={selected} /> : (
              <div className="h-full min-h-[300px] flex items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
                <p className="text-sm">Selecciona un análisis</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailPanel({ result }: { result: AnalysisResult }) {
  const riskColor = getRiskColor(result.riskLevel);
  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold">{result.filename}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(result.timestamp)}</p>
        </div>
        <span className={cn("text-xs font-medium px-2 py-1 rounded-md border", getModuleBadgeBg(result.module))}>
          {getModuleLabel(result.module)}
        </span>
      </div>

      {result.overlayUrl && (
        <img src={result.overlayUrl} alt="Overlay XAI"
          className="w-full rounded-lg object-contain bg-black max-h-56" />
      )}

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Score de riesgo</span>
          <span className={cn("font-bold", riskColor)}>{(result.riskScore * 100).toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full rounded-full",
            result.riskLevel === "low" ? "bg-emerald-400"
            : result.riskLevel === "medium" ? "bg-amber-400" : "bg-rose-400"
          )} style={{ width: `${Math.min(result.riskScore * 100, 100)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: "Nivel", value: result.riskLabel },
          { label: "Método XAI", value: result.xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++" },
          { label: "Tiempo", value: `${Math.round(result.processingTimeMs)}ms` },
          { label: "Versión", value: result.modelVersion || "v1" },
        ].map(({ label, value }) => (
          <div key={label} className="p-2 rounded-lg bg-muted">
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="font-medium mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {result.recommendation && (
        <div className="p-2.5 rounded-lg bg-muted border-l-2 border-sky-500/50 text-xs leading-relaxed">
          {result.recommendation}
        </div>
      )}
    </div>
  );
}
