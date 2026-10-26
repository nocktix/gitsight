import type { CommitSummary, MessageCheckStatus } from "../types/commitSummary";

const CHECK_LABELS: Record<MessageCheckStatus, string> = {
  coincide: "El mensaje coincide con los cambios",
  coincide_parcialmente: "El mensaje coincide parcialmente con los cambios",
  no_coincide: "El mensaje no coincide con los cambios",
  mensaje_generico: "El mensaje es genérico: no hay nada que contrastar con los cambios",
  no_evaluable: "No se puede comparar el mensaje con los cambios",
};

export function messageCheckLabel(status: MessageCheckStatus): string {
  return CHECK_LABELS[status] ?? "No se puede comparar el mensaje con los cambios";
}

/** Aviso cuando el LLM solo vio una parte del diff; null si lo vio completo. */
export function coverageNote(coverage: CommitSummary["coverage"]): string | null {
  if (!coverage.truncated) return null;
  const parts = [`${coverage.files_complete} de ${coverage.files_total} archivos completos`];
  if (coverage.files_partial > 0) parts.push(`${coverage.files_partial} recortados`);
  if (coverage.files_omitted > 0) parts.push(`${coverage.files_omitted} sin contenido`);
  return `Se analizó solo una parte del diff: ${parts.join(", ")}.`;
}

export function statsLine(stats: CommitSummary["stats"]): string {
  const files = stats.files === 1 ? "1 archivo" : `${stats.files} archivos`;
  return `${files} · +${stats.insertions} −${stats.deletions} líneas`;
}
