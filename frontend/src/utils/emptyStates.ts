/** Textos y comprobaciones de los estados vacíos (lenguaje simple: la audiencia son profesores). */

/** ¿Todos los commits caen fuera de [inicio, entrega]? Sin commits o sin fechas, no. */
export function allCommitsOutsideWindow(
  commitDays: string[],
  startKey: string | null,
  endKey: string | null,
): boolean {
  if (commitDays.length === 0 || (!startKey && !endKey)) return false;
  return commitDays.every((d) => (startKey && d < startKey) || (endKey && d > endKey));
}

export interface ArtifactPresence {
  /** Nombre que se espera encontrar. */
  expected: string;
  /** Etiqueta del archivo en lenguaje simple. */
  label: string;
  found: boolean;
}

/** Frases de lo que falta en el repo, p. ej. "la bitácora de prompts (bitacora_de_prompts.md)". */
export function missingArtifacts(items: ArtifactPresence[]): string[] {
  return items.filter((i) => !i.found).map((i) => `${i.label} (${i.expected})`);
}
