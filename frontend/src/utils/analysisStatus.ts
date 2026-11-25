import type { StoredAnalysis } from "./analysisStore";
import { analysisNotices, formatSantiago, rubricNotice } from "./analysisHistory.ts";

export interface AnalysisStatus {
  /** «Sin analizar», «Analizado el … con …». */
  text: string;
  /** Por qué el análisis mostrado quedó desactualizado (vacío si está al día). */
  outdatedReasons: string[];
}

/**
 * Estado del análisis para el encabezado. Está desactualizado cuando la rúbrica activa de la tarea
 * no es la que se usó, o cuando el repo tiene commits posteriores (mismas reglas que los avisos del
 * panel, que se siguen mostrando).
 */
export function analysisStatus(
  viewing: StoredAnalysis | null,
  activeRubricVersion: number | null,
  latestHashes: Set<string> | null,
): AnalysisStatus {
  if (!viewing) return { text: "Sin analizar", outdatedReasons: [] };
  const outdatedReasons: string[] = [];
  if (rubricNotice(viewing, activeRubricVersion)) outdatedReasons.push("rúbrica nueva");
  if (analysisNotices(viewing, latestHashes).length > 0) outdatedReasons.push("commits nuevos");
  return {
    text: `Analizado el ${formatSantiago(viewing.createdAt)} con ${viewing.model}`,
    outdatedReasons,
  };
}
