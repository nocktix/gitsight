export interface TaskConfigSummary {
  /** Una línea para la cabecera plegada, p. ej. «Entrega 09/11/2026 · Rúbrica v2 activa». */
  summary: string;
  /** Qué falta (vacío si la tarea ya tiene fecha de entrega y rúbrica). */
  missing: string[];
}

/** «2026-11-09» → «09/11/2026»; cualquier otra cosa se devuelve igual. */
export function formatDeadline(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export function taskConfigSummary(task: {
  endDate: string;
  rubric: string | null;
  rubricVersion: number | null;
}): TaskConfigSummary {
  const missing: string[] = [];
  const parts: string[] = [];
  if (task.endDate) parts.push(`Entrega ${formatDeadline(task.endDate)}`);
  else missing.push("la fecha de entrega");
  const hasRubric = task.rubricVersion !== null || (task.rubric !== null && task.rubric.trim() !== "");
  if (!hasRubric) missing.push("la rúbrica");
  else parts.push(task.rubricVersion !== null ? `Rúbrica v${task.rubricVersion} activa` : "Rúbrica cargada");
  return {
    summary: missing.length > 0 ? `Falta ${missing.join(" y ")}` : parts.join(" · "),
    missing,
  };
}
