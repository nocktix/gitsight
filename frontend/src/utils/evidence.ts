import type { Evidence, Finding, LinesEvidence } from "../types/analyze";

export type ArtifactKind = LinesEvidence["type"];

/** Nombres con que la interfaz llama a cada archivo. */
export const ARTIFACT_NAMES: Record<ArtifactKind, string> = {
  prompt_log: "Bitácora",
  authorship: "Autoría",
};

/** "L12–18", o "L4" si es una sola línea. */
export function lineRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}–${end}`;
}

/** Texto del chip: "commit a3f9c1", "Bitácora L12–18", "Autoría L4". */
export function evidenceLabel(ref: Evidence): string {
  if (ref.type === "commit") return `commit ${ref.hash.slice(0, 6)}`;
  return `${ARTIFACT_NAMES[ref.type]} ${lineRange(ref.line_start, ref.line_end)}`;
}

/** Hashes completos de los commits que cita el hallazgo; null si no cita ninguno. */
export function citedCommits(finding: Finding): Set<string> | null {
  const hashes = (finding.evidence ?? []).flatMap((ref) => (ref.type === "commit" ? [ref.hash] : []));
  return hashes.length > 0 ? new Set(hashes) : null;
}

/**
 * ¿Mostrar "sin evidencia vinculada"? Solo en análisis con evidencia (el campo existe), cuando
 * quedó vacía y el hallazgo no trata de un artefacto que falta o tiene otro nombre.
 */
export function showNoEvidenceLabel(finding: Finding): boolean {
  return finding.evidence !== undefined && finding.evidence.length === 0 && !finding.no_evidence_needed;
}
