import { useState, useCallback } from "react";
import type { DragEvent, ChangeEvent, RefObject } from "react";
import { useRef } from "react";
import {
  Upload, ScanEye, Loader2, FileImage, X, Download,
  AlertTriangle, CheckCircle, Info, Zap, Eye, Images,
  Activity, Microscope,
} from "lucide-react";
import axios from "axios";
import jsPDF from "jspdf";
import { cn, formatDate, normalizeScore, colorToRiskLevel,
         getRiskLabel, getRiskColor, getRiskBg,
         getModuleLabel, getModuleColor, getModuleBadgeBg } from "../lib/utils";
import type { ModuleType } from "../lib/utils";
import { useHistory } from "../contexts/HistoryContext";
import type { AnalysisResult, XAIMethod } from "../contexts/HistoryContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// EigenCAM es más estable que Grad-CAM++ para ambos módulos
// Ver: evaluación comparativa EigenCAM vs GradCAM++ en EfficientNet
const XAI_BACKEND_MAP: Record<XAIMethod, string> = {
  gradcam_plus_plus: "gradcam++",
  eigengradcam:      "eigengradcam",   // ← default recomendado
};

const MODULE_ENDPOINT: Record<ModuleType, string> = {
  glaucoma: "/analyze",
  dr:       "/analyze/dr",
};

// ── Tipos del backend ─────────────────────────────────────────────────────────
interface BackendRiskLevel { label: string; recommendation: string; color: string; }
interface BackendXAI {
  method: string;
  original_image_b64: string;
  heatmap_image_b64:  string;
  overlay_image_b64:  string;
}
interface BackendResponse {
  risk_score: number;
  risk_level: BackendRiskLevel;
  xai: BackendXAI;
  processing_time_ms: number;
  model_version: string;
  disclaimer: string;
  module?: string;
}

type HeatmapView = "overlay" | "heatmap" | "original";

export function AnalysisPage() {
  const { addAnalysis } = useHistory();
  const reportRef = useRef<HTMLDivElement>(null);

  const [imageFile, setImageFile]       = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [module, setModule]             = useState<ModuleType>("glaucoma");
  const [xaiMethod, setXaiMethod]       = useState<XAIMethod>("eigengradcam"); // EigenCAM default
  const [isDragging, setIsDragging]     = useState(false);
  const [loading, setLoading]           = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [error, setError]               = useState("");
  const [result, setResult]             = useState<AnalysisResult | null>(null);
  const [rawResponse, setRawResponse]   = useState<BackendResponse | null>(null);
  const [heatmapView, setHeatmapView]   = useState<HeatmapView>("overlay");

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDragOver  = (e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop      = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0]; if (f) loadImage(f);
  }, []);
  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) loadImage(f);
  };
  const loadImage = (file: File) => {
    if (!file.type.startsWith("image/")) { setError("Solo se aceptan imágenes JPG o PNG."); return; }
    setImageFile(file); setError(""); setResult(null); setRawResponse(null);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };
  const clearImage = () => {
    setImageFile(null); setImagePreview(""); setResult(null); setRawResponse(null); setError("");
  };

  // ── Análisis ──────────────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!imageFile) return;
    setLoading(true); setError(""); setResult(null); setRawResponse(null);
    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("xai_method", XAI_BACKEND_MAP[xaiMethod]);

      const { data } = await axios.post<BackendResponse>(
        `${API_BASE}${MODULE_ENDPOINT[module]}`, formData,
        { headers: { "Content-Type": "multipart/form-data" }, timeout: 90000 }
      );

      setRawResponse(data);
      const riskScore  = normalizeScore(data.risk_score);
      const riskLevel  = colorToRiskLevel(data.risk_level.color);
      const b64        = (s: string) => `data:image/png;base64,${s}`;

      const ar: AnalysisResult = {
        id:                   `${Date.now()}-${Math.random().toString(36).substr(2,9)}`,
        timestamp:            new Date().toISOString(),
        filename:             imageFile.name,
        module,
        imageDataUrl:         imagePreview,
        overlayUrl:           b64(data.xai.overlay_image_b64),
        heatmapUrl:           b64(data.xai.heatmap_image_b64),
        originalProcessedUrl: b64(data.xai.original_image_b64),
        riskScore,
        riskLevel,
        riskLabel:            data.risk_level.label,
        recommendation:       data.risk_level.recommendation,
        xaiMethod,
        processingTimeMs:     data.processing_time_ms,
        modelVersion:         data.model_version,
      };
      setResult(ar);
      setHeatmapView("overlay");
      addAnalysis(ar);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.code === "ECONNREFUSED" || err.code === "ERR_NETWORK")
          setError("No se pudo conectar al backend en localhost:8000.");
        else {
          const d = (err.response?.data as { detail?: string })?.detail;
          setError(d ?? `Error ${String(err.response?.status ?? "")}`);
        }
      } else setError("Error inesperado.");
    } finally { setLoading(false); }
  };

  // ── PDF ───────────────────────────────────────────────────────────────────────
  const handleExportPDF = async () => {
    if (!result || !rawResponse) return;
    setExportingPDF(true);
    try {
      let interpretation = "";
      try {
        const { data } = await axios.post<{ interpretation: string }>(
          `${API_BASE}/generate-report`,
          {
            risk_score: rawResponse.risk_score,
            risk_label: rawResponse.risk_level.label,
            risk_color: rawResponse.risk_level.color,
            recommendation: rawResponse.risk_level.recommendation,
            xai_method: XAI_BACKEND_MAP[result.xaiMethod],
            filename: result.filename,
            processing_time_ms: result.processingTimeMs,
            module: result.module,
          },
          { timeout: 35000 }
        );
        interpretation = data.interpretation;
      } catch {
        interpretation = buildFallback(result, rawResponse);
      }
      await generatePDF(result, rawResponse, interpretation);
    } catch (e) {
      console.error(e);
      setError("Error al generar el PDF.");
    } finally { setExportingPDF(false); }
  };

  const activeUrl = result
    ? heatmapView === "overlay"  ? result.overlayUrl
    : heatmapView === "heatmap"  ? result.heatmapUrl
    : result.originalProcessedUrl
    : "";

  const views: { key: HeatmapView; label: string }[] = [
    { key: "overlay",  label: "Superposición" },
    { key: "heatmap",  label: "Mapa de calor" },
    { key: "original", label: "Preprocesada"  },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="grid lg:grid-cols-2 gap-5">

        {/* ── Izquierda ── */}
        <div className="space-y-4">

          {/* Selector de módulo */}
          <div className="grid grid-cols-2 gap-3">
            {(["glaucoma", "dr"] as ModuleType[]).map(m => {
              const active = module === m;
              return (
                <button key={m} onClick={() => { setModule(m); setResult(null); setError(""); }}
                  className={cn(
                    "flex flex-col items-start p-3.5 rounded-xl border text-left transition-all",
                    active
                      ? m === "glaucoma"
                        ? "border-sky-500/60 bg-sky-500/10"
                        : "border-violet-500/60 bg-violet-500/10"
                      : "border-border hover:bg-muted"
                  )}>
                  <div className="flex items-center gap-2 mb-1">
                    {m === "glaucoma"
                      ? <Eye className={cn("h-4 w-4", active ? "text-sky-400" : "text-muted-foreground")} />
                      : <Activity className={cn("h-4 w-4", active ? "text-violet-400" : "text-muted-foreground")} />
                    }
                    <span className={cn("text-sm font-semibold",
                      active ? getModuleColor(m) : "text-muted-foreground"
                    )}>
                      {m === "glaucoma" ? "Glaucoma" : "Ret. Diabética"}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {m === "glaucoma"
                      ? "Detección de signos en nervio óptico"
                      : "Clasificación RD referible vs no referible"
                    }
                  </span>
                  {active && (
                    <span className={cn("mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded border",
                      getModuleBadgeBg(m)
                    )}>
                      {m === "glaucoma" ? "AUROC 94.38%" : "AUROC 98.25%"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Carga de imagen */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileImage className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Imagen Fundus</span>
              <span className="text-xs text-muted-foreground ml-auto">JPG, PNG</span>
            </div>
            {!imagePreview ? (
              <label onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                className={cn(
                  "flex flex-col items-center justify-center h-44 rounded-lg border-2 border-dashed cursor-pointer transition-all",
                  isDragging ? "border-sky-500 bg-sky-500/5" : "border-border hover:border-muted-foreground/40 hover:bg-muted/50"
                )}>
                <Upload className={cn("h-7 w-7 mb-2", isDragging ? "text-sky-400" : "text-muted-foreground")} />
                <p className="text-sm text-muted-foreground">
                  {isDragging ? "Suelta la imagen" : "Arrastra o haz clic"}
                </p>
                <input type="file" className="hidden" accept="image/jpeg,image/png" onChange={handleFileInput} />
              </label>
            ) : (
              <div className="relative">
                <img src={imagePreview} alt="Fundus" className="w-full h-44 object-contain rounded-lg bg-black" />
                <button onClick={clearImage}
                  className="absolute top-2 right-2 p-1 rounded-full bg-background/80 border border-border hover:bg-background transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
                <p className="mt-1.5 text-xs text-muted-foreground truncate">{imageFile?.name}</p>
              </div>
            )}
          </div>

          {/* Selector XAI */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Método XAI</span>
              <span className="text-[10px] text-muted-foreground ml-auto bg-muted px-1.5 py-0.5 rounded">
                Explicabilidad visual
              </span>
            </div>
            <div className="space-y-2">
              {([
                {
                  value: "eigengradcam",
                  label: "EigenCAM",
                  badge: "Recomendado",
                  desc: "Estable en todos los scores · Localización global del nervio óptico",
                },
                {
                  value: "gradcam_plus_plus",
                  label: "Grad-CAM++",
                  badge: "",
                  desc: "Mayor detalle en lesiones · Mejor con scores moderados-altos",
                },
              ] as { value: XAIMethod; label: string; badge: string; desc: string }[]).map(({ value, label, badge, desc }) => (
                <label key={value} className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                  xaiMethod === value ? "border-sky-500/50 bg-sky-500/5" : "border-border hover:bg-muted"
                )}>
                  <input type="radio" name="xai" value={value} checked={xaiMethod === value}
                    onChange={() => setXaiMethod(value)} className="accent-sky-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{label}</span>
                      {badge && (
                        <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-medium">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleAnalyze} disabled={!imageFile || loading}
            className={cn(
              "w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all",
              !imageFile || loading
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : module === "glaucoma"
                  ? "bg-sky-500 hover:bg-sky-400 text-white"
                  : "bg-violet-500 hover:bg-violet-400 text-white"
            )}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Analizando...</>
              : <><Microscope className="h-4 w-4" />Analizar con {getModuleLabel(module)}</>
            }
          </button>

          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-sm text-rose-400 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{error}
            </div>
          )}
        </div>

        {/* ── Derecha ── */}
        <div>
          {!result && !loading && (
            <div className="h-full min-h-[480px] flex flex-col items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground">
              <ScanEye className="h-10 w-10 mb-3 opacity-20" />
              <p className="text-sm">El resultado aparecerá aquí</p>
              <p className="text-xs mt-1 opacity-60">Selecciona un módulo y sube una imagen</p>
            </div>
          )}

          {loading && (
            <div className="h-full min-h-[480px] flex flex-col items-center justify-center rounded-xl border border-border">
              <div className="relative w-20 h-20 mb-5">
                <div className="absolute inset-0 rounded-full border-4 border-muted" />
                <div className={cn("absolute inset-0 rounded-full border-4 border-t-transparent animate-spin",
                  module === "glaucoma" ? "border-sky-500" : "border-violet-500"
                )} />
                <Microscope className="absolute inset-0 m-auto h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">Procesando imagen...</p>
              <p className="text-xs text-muted-foreground mt-1">
                {getModuleLabel(module)} · {xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++"}
              </p>
            </div>
          )}

          {result && (
            <ResultPanel
              result={result}
              activeUrl={activeUrl}
              heatmapView={heatmapView}
              onViewChange={setHeatmapView}
              views={views}
              onExport={handleExportPDF}
              exportingPDF={exportingPDF}
              reportRef={reportRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Panel de resultado ─────────────────────────────────────────────────────────
function ResultPanel({ result, activeUrl, heatmapView, onViewChange, views, onExport, exportingPDF, reportRef }: {
  result: AnalysisResult;
  activeUrl: string;
  heatmapView: HeatmapView;
  onViewChange: (v: HeatmapView) => void;
  views: { key: HeatmapView; label: string }[];
  onExport: () => void;
  exportingPDF: boolean;
  reportRef: RefObject<HTMLDivElement>;
}) {
  const riskColor = getRiskColor(result.riskLevel);
  const riskBg    = getRiskBg(result.riskLevel);

  return (
    <div className="space-y-4" ref={reportRef}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-medium px-2 py-1 rounded-md border", getModuleBadgeBg(result.module))}>
          {getModuleLabel(result.module)}
        </span>
        <button onClick={onExport} disabled={exportingPDF}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
          {exportingPDF ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {exportingPDF ? "Generando..." : "Exportar PDF"}
        </button>
      </div>

      {/* Score */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Resultado</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(result.timestamp)}</p>
          </div>
          {result.riskLevel === "low"
            ? <CheckCircle className="h-5 w-5 text-emerald-400" />
            : result.riskLevel === "medium"
            ? <Info className="h-5 w-5 text-amber-400" />
            : <AlertTriangle className="h-5 w-5 text-rose-400" />
          }
        </div>

        <div className={cn("p-4 rounded-xl border", riskBg)}>
          <div className="flex items-baseline justify-between mb-2.5">
            <span className={cn("text-base font-bold", riskColor)}>{result.riskLabel}</span>
            <span className={cn("text-3xl font-black tabular-nums", riskColor)}>
              {(result.riskScore * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-background/40 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-1000",
              result.riskLevel === "low" ? "bg-emerald-400"
              : result.riskLevel === "medium" ? "bg-amber-400" : "bg-rose-400"
            )} style={{ width: `${Math.min(result.riskScore * 100, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1 text-muted-foreground">
            <span>Sin riesgo</span><span>Alto riesgo</span>
          </div>
        </div>

        {result.recommendation && (
          <div className="mt-3 p-3 rounded-lg bg-muted border-l-2 border-sky-500/60">
            <p className="text-[10px] text-muted-foreground font-medium mb-0.5 uppercase tracking-wide">Recomendación clínica</p>
            <p className="text-xs leading-relaxed">{result.recommendation}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { label: "Score",  value: `${(result.riskScore * 100).toFixed(1)}%` },
            { label: "Método", value: result.xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++" },
            { label: "Tiempo", value: `${Math.round(result.processingTimeMs)}ms` },
          ].map(({ label, value }) => (
            <div key={label} className="p-2 rounded-lg bg-muted text-center">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="text-xs font-semibold mt-0.5">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Visor XAI */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Mapa de activación XAI</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 ml-6">
              {result.xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++"} — rojo = zona relevante para la predicción
            </p>
          </div>
          <div className="flex bg-muted rounded-lg p-0.5 shrink-0">
            {views.map(({ key, label }) => (
              <button key={key} onClick={() => onViewChange(key)}
                className={cn("px-2 py-1 rounded-md text-[11px] font-medium transition-all",
                  heatmapView === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeUrl ? (
          <img key={heatmapView} src={activeUrl} alt="XAI"
            className="w-full rounded-lg object-contain bg-black"
            style={{ minHeight: "200px", maxHeight: "360px" }} />
        ) : (
          <div className="flex flex-col items-center justify-center h-40 rounded-lg bg-muted text-muted-foreground">
            <Images className="h-7 w-7 mb-2 opacity-30" />
            <p className="text-xs">Sin imagen disponible</p>
          </div>
        )}

        {heatmapView !== "original" && (
          <div className="flex items-center gap-3 mt-3 justify-center flex-wrap">
            {[
              { color: "bg-rose-500",   label: "Alta activación" },
              { color: "bg-amber-400",  label: "Media"           },
              { color: "bg-emerald-500",label: "Baja"            },
              { color: "bg-blue-900",   label: "Sin activación"  },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-500/90 flex gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Herramienta de apoyo al screening en atención primaria. No reemplaza la evaluación de un especialista en oftalmología.
      </div>
    </div>
  );
}

// ── Fallback interpretación ───────────────────────────────────────────────────
function buildFallback(result: AnalysisResult, raw: BackendResponse): string {
  const pct    = (result.riskScore * 100).toFixed(1);
  const module = result.module === "glaucoma" ? "glaucoma" : "retinopatía diabética";
  const method = result.xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++";
  return `Resumen Ejecutivo\n\nEl sistema RikunaLab analizó la imagen fundus "${result.filename}" mediante el módulo de ${module}. El modelo asignó un score de riesgo de ${pct}%, correspondiente a un nivel de ${raw.risk_level.label}. El análisis utilizó el método de explicabilidad ${method}.\n\nInterpretación del Score de Riesgo\n\nUn score de ${pct}% indica ${result.riskLevel === "low" ? "bajo riesgo. No se identificaron hallazgos significativos compatibles con la condición evaluada." : result.riskLevel === "medium" ? "riesgo moderado. Se recomienda seguimiento y evaluación especializada en los próximos meses." : "alto riesgo. Se identificaron características compatibles con la condición evaluada que requieren atención especializada prioritaria."}\n\nRecomendaciones para el Especialista\n\n${raw.risk_level.recommendation}\n\nLimitaciones del Screening Automatizado\n\nEste resultado fue generado por un modelo de inteligencia artificial entrenado con imágenes de referencia internacional. La evaluación clínica final debe realizarse por un especialista en oftalmología.`;
}

// ── PDF ────────────────────────────────────────────────────────────────────────
async function generatePDF(result: AnalysisResult, raw: BackendResponse, interpretation: string) {
  const pdf    = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W      = 210;
  const M      = 16;   // margin
  const cW     = W - M * 2;
  let y        = 0;

  // ── PALETA: fondo blanco, texto oscuro ────────────────────────────────────
  type RGB = [number, number, number];

  // Texto
  const BLACK  : RGB = [15,  15,  15];   // títulos principales
  const DARK   : RGB = [40,  40,  40];   // texto cuerpo
  const MEDIUM : RGB = [80,  80,  80];   // texto secundario
  const LIGHT  : RGB = [130, 130, 130];  // texto muted / pie de página

  // Fondos y bordes
  const WHITE  : RGB = [255, 255, 255];
  const BG1    : RGB = [248, 249, 251];  // fondo secciones alternadas
  const BG2    : RGB = [240, 243, 247];  // fondo celdas tabla
  const BORDER : RGB = [215, 220, 228];  // líneas separadoras

  // Colores de acento según módulo
  const ACCENT : RGB = result.module === "glaucoma"
    ? [12, 105, 170]    // azul médico
    : [88,  48, 180];   // violeta

  // Colores de riesgo
  const RISK_LOW  : RGB = [22, 120, 60];
  const RISK_MED  : RGB = [150, 90,  10];
  const RISK_HIGH : RGB = [160, 30,  30];
  const rRGB: RGB = result.riskLevel === "low" ? RISK_LOW
    : result.riskLevel === "medium" ? RISK_MED : RISK_HIGH;

  // Fondos de riesgo (muy tenues)
  const RISK_LOW_BG  : RGB = [230, 248, 236];
  const RISK_MED_BG  : RGB = [255, 244, 220];
  const RISK_HIGH_BG : RGB = [255, 232, 232];
  const rBG: RGB = result.riskLevel === "low" ? RISK_LOW_BG
    : result.riskLevel === "medium" ? RISK_MED_BG : RISK_HIGH_BG;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const fill = (x: number, yy: number, w: number, h: number, col: RGB, r = 0) => {
    pdf.setFillColor(...col);
    r > 0 ? pdf.roundedRect(x, yy, w, h, r, r, "F") : pdf.rect(x, yy, w, h, "F");
  };

  const hline = (yy: number, col: RGB = BORDER, lw = 0.25) => {
    pdf.setDrawColor(...col);
    pdf.setLineWidth(lw);
    pdf.line(M, yy, M + cW, yy);
  };

  const t = (
    s: string, x: number, yy: number,
    col: RGB, size: number,
    bold = false,
    align: "left" | "center" | "right" = "left"
  ) => {
    pdf.setTextColor(...col);
    pdf.setFontSize(size);
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.text(s, x, yy, { align });
  };

  const wrap = (s: string, maxW: number) =>
    pdf.splitTextToSize(s, maxW) as string[];

  const sectionHeader = (title: string) => {
    if (y > 262) { newPage(); }
    y += 5;
    t(title, M, y, ACCENT, 8.5, true);
    y += 2;
    hline(y, ACCENT, 0.5);
    y += 5;
  };

  const newPage = () => {
    pdf.addPage();
    fill(0, 0, W, 297, WHITE);
    // mini header
    fill(0, 0, W, 9, BG1);
    hline(9, BORDER, 0.3);
    t("RikunaLab — Informe de Screening Retinal", M, 6, LIGHT, 6);
    t(result.filename, W - M, 6, LIGHT, 6, false, "right");
    y = 17;
  };

  // ── PÁGINA 1 ─────────────────────────────────────────────────────────────
  fill(0, 0, W, 297, WHITE);

  // Header
  fill(0, 0, W, 34, BG1);
  hline(34, ACCENT, 1);

  // Logo badge
  fill(M, 7, 18, 10, ACCENT, 2);
  t("RLab", M + 9, 13.5, WHITE, 6.5, true, "center");

  // Nombre y subtítulo
  t("RikunaLab", M + 23, 13, BLACK, 11, true);
  t("Plataforma de Screening Retinal con Inteligencia Artificial Explicable",
    M + 23, 19, MEDIUM, 6.5);
  t(`Módulo: ${getModuleLabel(result.module)}`,
    M + 23, 25, ACCENT, 6.5, true);

  // Metadatos derecha
  t(`Módulo: ${getModuleLabel(result.module)}`, W - M, 13, MEDIUM, 6.5, false, "right");
  t(`Generado: ${formatDate(result.timestamp)}`,  W - M, 19, MEDIUM, 6.5, false, "right");
  t(`Archivo: ${result.filename}`,                W - M, 25, LIGHT,  6,   false, "right");

  y = 42;

  // ── Bloque resultado ─────────────────────────────────────────────────────
  fill(M, y, cW, 48, rBG, 3);
  // franja lateral de color
  fill(M, y, 4, 48, rRGB, 0);

  t("RESULTADO DEL SCREENING", M + 10, y + 8, MEDIUM, 5.5, true);

  // Nivel de riesgo + score
  t(result.riskLabel, M + 10, y + 18, rRGB, 10, true);
  t(`${(result.riskScore * 100).toFixed(1)}%`, W - M - 6, y + 18, rRGB, 10, true, "right");

  // Barra de progreso
  const bx = M + 10; const by = y + 22; const bw = cW - 16;
  fill(bx, by, bw, 3.5, BORDER, 1);
  fill(bx, by, Math.max(bw * result.riskScore, 3), 3.5, rRGB, 1);
  t("0%", bx, by + 8, LIGHT, 5);
  t("100%", bx + bw, by + 8, LIGHT, 5, false, "right");

  // Recomendación
  t("Recomendación clínica:", M + 10, y + 36, MEDIUM, 6, true);
  const recLines = wrap(raw.risk_level.recommendation, cW - 20);
  pdf.setTextColor(...DARK); pdf.setFontSize(6.5); pdf.setFont("helvetica", "normal");
  pdf.text(recLines, M + 10, y + 42);

  y += 55;

  // ── Tabla de métricas técnicas ────────────────────────────────────────────
  const auroc = result.module === "glaucoma" ? "94.38%" : "98.25%";
  const sens  = result.module === "glaucoma" ? "86.75%" : "96.64%";
  const spec  = result.module === "glaucoma" ? "88.83%" : "94.95%";

  const cells: [string, string][] = [
    ["Score de riesgo",   `${(result.riskScore * 100).toFixed(1)}%`],
    ["Método XAI",        result.xaiMethod === "eigengradcam" ? "EigenCAM" : "Grad-CAM++"],
    ["Tiempo de análisis", `${Math.round(result.processingTimeMs)} ms`],
    ["Arquitectura IA",   "EfficientNet-B3"],
    ["AUROC (test set)",  auroc],
    ["Sensibilidad",      sens],
    ["Especificidad",     spec],
    ["Dataset",           result.module === "glaucoma" ? "AIROGS-light-v2" : "APTOS 2019"],
  ];

  const colW = (cW - 2) / 2;
  t("PARÁMETROS TÉCNICOS DEL ANÁLISIS", M, y, MEDIUM, 6, true);
  y += 3;
  hline(y, BORDER, 0.3);
  y += 3;

  cells.forEach(([label, value], i) => {
    const col  = i % 2;
    const row  = Math.floor(i / 2);
    const cx   = M + col * (colW + 2);
    const cy   = y + row * 8;
    fill(cx, cy, colW, 7, col === 0 ? BG2 : WHITE, 0);
    t(label, cx + 3, cy + 4.8, MEDIUM, 5.8);
    t(value, cx + colW - 3, cy + 4.8, DARK, 5.8, true, "right");
  });

  y += Math.ceil(cells.length / 2) * 8 + 4;
  hline(y, BORDER, 0.3);

  // ── PÁGINA 2: Imágenes XAI ────────────────────────────────────────────────
  newPage();
  sectionHeader("ANÁLISIS VISUAL — MAPAS DE ACTIVACIÓN XAI");

  // Descripción del método
  const methodText = result.xaiMethod === "eigengradcam"
    ? "EigenCAM opera mediante descomposición de valores propios de las activaciones de la última capa convolucional. No depende de gradientes de retropropagación, produciendo mapas estables e interpretativos documentados con IoU@0.3 de 0.563 en imágenes retinales con EfficientNet (vs 0.22 de Grad-CAM++). Las zonas en rojo/naranja indican regiones de mayor relevancia para la predicción."
    : "Grad-CAM++ utiliza gradientes de orden superior para localizar con mayor precisión lesiones específicas. Más informativo cuando el score es moderado-alto (30-80%). Las zonas en rojo/naranja indican las regiones que el modelo considera más determinantes para la clasificación.";

  fill(M, y, cW, wrap(methodText, cW - 6).length * 4.2 + 6, BG1, 2);
  pdf.setTextColor(...DARK); pdf.setFontSize(6.5); pdf.setFont("helvetica", "normal");
  pdf.text(wrap(methodText, cW - 8), M + 4, y + 5);
  y += wrap(methodText, cW - 6).length * 4.2 + 10;

  // Imágenes XAI
  const imgs: [string, string, string][] = [
    ["Imagen Preprocesada",    "Ben Graham + CLAHE",         result.originalProcessedUrl],
    ["Superposición (Overlay)","Original + mapa de activación", result.overlayUrl],
    ["Mapa de Calor Puro",     "Activaciones XAI",           result.heatmapUrl],
  ];

  const iW = (cW - 6) / 3;
  const iH = 68;

  imgs.forEach(([label, desc, url], i) => {
    const ix = M + i * (iW + 3);
    fill(ix, y, iW, iH + 16, BG1, 2);
    pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
    pdf.roundedRect(ix, y, iW, iH + 16, 2, 2, "S");
    t(label, ix + iW / 2, y + 6,  DARK,  5.5, true, "center");
    t(desc,  ix + iW / 2, y + 10, LIGHT, 5,   false, "center");
    try {
      pdf.addImage(url, "PNG", ix + 2, y + 13, iW - 4, iH, undefined, "FAST");
    } catch { /**/ }
  });

  y += iH + 20;

  // Leyenda
  t("Interpretación del mapa de calor:", M, y, MEDIUM, 6, true);
  y += 4;
  const legend: [string, RGB][] = [
    ["Alta activación",  [200, 50,  50]],
    ["Activación media", [210, 130, 20]],
    ["Activación baja",  [40,  155, 40]],
    ["Sin activación",   [40,  60, 160]],
  ];
  legend.forEach(([lbl, col], i) => {
    const lx = M + i * 46;
    fill(lx, y, 6, 4, col as RGB, 1);
    t(lbl, lx + 8, y + 3.5, MEDIUM, 5.5);
  });
  y += 10;

  // ── PÁGINA 3: Interpretación clínica ─────────────────────────────────────
  newPage();
  sectionHeader("INTERPRETACIÓN CLÍNICA");

  const cleanText = interpretation
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/#{1,6}\s/g, "");

  for (const para of cleanText.split("\n").filter(l => l.trim())) {
    const isHeader = para.trim().length < 65 && !para.trim().endsWith(".");
    const lines    = wrap(para.trim(), cW - 6);
    const blockH   = lines.length * 4.6 + (isHeader ? 12 : 4);

    if (y + blockH > 268) { newPage(); }

    if (isHeader) {
      y += 5;
      fill(M, y, cW, 9, BG2, 1);
      fill(M, y, 3, 9, ACCENT, 0);
      t(para.trim(), M + 7, y + 6, BLACK, 7, true);
      y += 13;
    } else {
      pdf.setTextColor(...DARK);
      pdf.setFontSize(6.8);
      pdf.setFont("helvetica", "normal");
      pdf.text(lines, M + 2, y + 4);
      y += lines.length * 4.6 + 3;
    }
  }

  // ── Aviso legal ───────────────────────────────────────────────────────────
  if (y > 255) { newPage(); }
  y = Math.max(y + 8, 255);

  fill(M, y, cW, 22, [255, 248, 230] as RGB, 2);
  pdf.setDrawColor(200, 150, 20); pdf.setLineWidth(0.4);
  pdf.roundedRect(M, y, cW, 22, 2, 2, "S");
  fill(M, y, 3, 22, [190, 130, 10] as RGB, 0);

  t("AVISO IMPORTANTE — HERRAMIENTA DE SCREENING CLÍNICO",
    M + 8, y + 7, [150, 95, 10] as RGB, 6, true);

  const discLines = wrap(
    raw.disclaimer +
    " Los resultados de este informe no constituyen un diagnóstico médico definitivo. " +
    "Se requiere evaluación por especialista en oftalmología para la confirmación diagnóstica.",
    cW - 14
  );
  pdf.setTextColor(130, 85, 10);
  pdf.setFontSize(5.8);
  pdf.setFont("helvetica", "normal");
  pdf.text(discLines, M + 8, y + 13);

  // ── Footer en todas las páginas ───────────────────────────────────────────
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    hline(286, BORDER, 0.3);
    fill(0, 287, W, 10, BG1);
    t("RikunaLab · Screening Retinal con IA", M, 293, LIGHT, 5.5);
    t(`Página ${i} de ${total}`, W / 2, 293, LIGHT, 5.5, false, "center");
    t("Confidencial — Uso médico exclusivo", W - M, 293, LIGHT, 5.5, false, "right");
  }

  const name = result.filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  pdf.save(`RikunaLab_${result.module.toUpperCase()}_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
}