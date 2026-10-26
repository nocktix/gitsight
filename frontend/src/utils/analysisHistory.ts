import type { CommitsData } from "../types/commits";
import type { StoredAnalysis } from "./analysisStore";

/** "27-05-2026 10:00" en hora de Chile, sea cual sea la zona del navegador. */
export function formatSantiago(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

/** "rúbrica v2", "sin rúbrica" o "versión de rúbrica desconocida". */
export function rubricLabel(analysis: Pick<StoredAnalysis, "rubricVersion" | "rubricState">): string {
  if (analysis.rubricState === "none") return "sin rúbrica";
  if (analysis.rubricState === "unknown" || analysis.rubricVersion === null) {
    return "versión de rúbrica desconocida";
  }
  return `rúbrica v${analysis.rubricVersion}`;
}

/** Texto de una opción del selector de historial. */
export function historyLabel(analysis: StoredAnalysis, isLatest: boolean): string {
  const base = `${formatSantiago(analysis.createdAt)} · ${analysis.model} · ${rubricLabel(analysis)}`;
  return isLatest ? `${base} (más reciente)` : base;
}

/**
 * Hashes completos de los commits más recientes del repo (varios si comparten el instante).
 * Es el mismo conjunto de commits que usa el análisis para guardar `head_commit`: sin bots ni
 * staff. null si no hay commits que comparar.
 */
export function latestCommitHashes(data: CommitsData): Set<string> | null {
  let latest = -Infinity;
  let hashes = new Set<string>();
  for (const days of Object.values(data.authorDailyContributionsMap)) {
    for (const day of days) {
      for (const commit of day.commitResults) {
        const at = Date.parse(commit.authoredAt);
        if (at > latest) {
          latest = at;
          hashes = new Set([commit.hash]);
        } else if (at === latest) {
          hashes.add(commit.hash);
        }
      }
    }
  }
  return hashes.size > 0 ? hashes : null;
}

/**
 * Aviso discreto cuando el análisis no se hizo con la rúbrica activa de la tarea; null si
 * coincide o si la tarea no tiene rúbrica. Va acompañado del botón para re-analizar (que el
 * evaluador pulsa a mano: nunca se re-analiza solo).
 */
export function rubricNotice(
  analysis: Pick<StoredAnalysis, "rubricVersion" | "rubricState">,
  activeVersion: number | null,
): string | null {
  if (activeVersion === null) return null;
  if (analysis.rubricState === "none") return "Hecho sin rúbrica";
  if (analysis.rubricState === "unknown" || analysis.rubricVersion === null) {
    return "Hecho con una rúbrica de versión desconocida";
  }
  if (analysis.rubricVersion === activeVersion) return null;
  // Con una versión antigua activada de nuevo, el análisis puede ser de una versión más nueva.
  return analysis.rubricVersion < activeVersion
    ? `Hecho con una rúbrica anterior (v${analysis.rubricVersion})`
    : `Hecho con la rúbrica v${analysis.rubricVersion}, distinta de la activa (v${activeVersion})`;
}

/** Avisos informativos de un análisis frente al estado actual del repo. */
export function analysisNotices(
  analysis: StoredAnalysis,
  latestHashes: Set<string> | null,
): string[] {
  const notices: string[] = [];
  // Los análisis importados no guardaron el commit: no hay con qué comparar.
  if (analysis.headCommit && latestHashes && !latestHashes.has(analysis.headCommit)) {
    notices.push("El repo tiene commits posteriores a este análisis");
  }
  return notices;
}
