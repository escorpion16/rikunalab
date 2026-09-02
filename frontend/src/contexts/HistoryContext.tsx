import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type XAIMethod  = "gradcam_plus_plus" | "eigengradcam";
export type RiskLevel  = "low" | "medium" | "high";
export type ModuleType = "glaucoma" | "dr";

export interface AnalysisResult {
  id:                   string;
  timestamp:            string;
  filename:             string;
  module:               ModuleType;
  imageDataUrl:         string;
  overlayUrl:           string;
  heatmapUrl:           string;
  originalProcessedUrl: string;
  riskScore:            number;
  riskLevel:            RiskLevel;
  riskLabel:            string;
  recommendation:       string;
  xaiMethod:            XAIMethod;
  processingTimeMs:     number;
  modelVersion:         string;
}

interface HistoryContextType {
  history: AnalysisResult[];
  addAnalysis: (r: AnalysisResult) => void;
  clearHistory: () => void;
  deleteAnalysis: (id: string) => void;
}

const STORAGE_KEY = "rikunalab_history_v1";

function load(): AnalysisResult[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); }
  catch { return []; }
}

const Ctx = createContext<HistoryContextType | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<AnalysisResult[]>(load);

  const persist = (data: AnalysisResult[]) => {
    const slim = data.map(({ imageDataUrl: _a, overlayUrl: _b, heatmapUrl: _c, originalProcessedUrl: _d, ...rest }) =>
      ({ ...rest, imageDataUrl: "", overlayUrl: "", heatmapUrl: "", originalProcessedUrl: "" }));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slim.slice(0, 50))); } catch { /**/ }
  };

  const addAnalysis = (r: AnalysisResult) =>
    setHistory(prev => { const u = [r, ...prev].slice(0, 50); persist(u); return u; });

  const deleteAnalysis = (id: string) =>
    setHistory(prev => { const u = prev.filter(r => r.id !== id); persist(u); return u; });

  const clearHistory = () => { setHistory([]); localStorage.removeItem(STORAGE_KEY); };

  return <Ctx.Provider value={{ history, addAnalysis, clearHistory, deleteAnalysis }}>{children}</Ctx.Provider>;
}

export function useHistory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}
