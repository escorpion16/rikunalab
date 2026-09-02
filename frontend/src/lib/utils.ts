import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RiskLevel } from "../contexts/HistoryContext";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("es-EC", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(date));
}

export function normalizeScore(score: number): number {
  return score > 1 ? score / 100 : score;
}

export function colorToRiskLevel(color: string): RiskLevel {
  if (color === "green")  return "low";
  if (color === "yellow") return "medium";
  return "high";
}

export function getRiskLevel(score: number): RiskLevel {
  if (score < 0.30) return "low";
  if (score < 0.65) return "medium";
  return "high";
}

export function getRiskLabel(level: RiskLevel): string {
  return { low: "Bajo Riesgo", medium: "Riesgo Moderado", high: "Alto Riesgo" }[level];
}

export function getRiskColor(level: RiskLevel): string {
  return { low: "text-emerald-400", medium: "text-amber-400", high: "text-rose-400" }[level];
}

export function getRiskBg(level: RiskLevel): string {
  return {
    low:    "bg-emerald-500/10 border-emerald-500/30",
    medium: "bg-amber-500/10 border-amber-500/30",
    high:   "bg-rose-500/10 border-rose-500/30",
  }[level];
}

export type ModuleType = "glaucoma" | "dr";

export function getModuleLabel(module: ModuleType): string {
  return module === "glaucoma" ? "Glaucoma" : "Retinopatía Diabética";
}

export function getModuleColor(module: ModuleType): string {
  return module === "glaucoma" ? "text-sky-400" : "text-violet-400";
}

export function getModuleBadgeBg(module: ModuleType): string {
  return module === "glaucoma"
    ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
    : "bg-violet-500/15 text-violet-300 border-violet-500/30";
}
