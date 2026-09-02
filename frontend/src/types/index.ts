export type XAIMethod = "gradcam_plus_plus" | "eigengradcam";

export type RiskLevel = "low" | "medium" | "high";

export interface AnalysisResult {
  id: string;
  timestamp: string;
  filename: string;
  imageDataUrl: string;         // imagen original (base64 para preview)
  heatmapUrl: string;           // URL del heatmap devuelto por el backend
  riskScore: number;            // 0.0 - 1.0
  riskLevel: RiskLevel;
  prediction: "RG" | "NRG";    // Referable Glaucoma / No Referable Glaucoma
  confidence: number;           // 0.0 - 1.0
  xaiMethod: XAIMethod;
  processingTimeMs: number;
}

export interface BackendResponse {
  prediction: "RG" | "NRG";
  confidence: number;
  risk_score: number;
  heatmap_base64: string;
  processing_time_ms: number;
  xai_method: string;
}

export interface User {
  email: string;
  name: string;
  role: string;
}

export interface ModelMetrics {
  auroc: number;
  sensitivity: number;
  specificity: number;
  dataset: string;
  trainImages: number;
  architecture: string;
}
