import type { ParsedRepo } from "./repoUrl";

export type UrlCheck =
  | { kind: "empty" }
  | { kind: "valid"; text: string }
  | { kind: "invalid"; text: string };

export const INVALID_URL_TEXT = "Debe verse como https://github.com/organizacion/repositorio";

/**
 * Revisión de la URL mientras se escribe. `parsed` es lo que devuelve la misma deducción que usa
 * la app para abrir el repo (`detectTask`), así que aquí no hay una regla propia: si la tarea no es
 * conocida se avisa que se pedirá confirmarla (lo mismo que decide mostrar TaskConfirm).
 */
export function checkRepoUrl(input: string, parsed: ParsedRepo | null): UrlCheck {
  if (!input.trim()) return { kind: "empty" };
  if (!parsed) return { kind: "invalid", text: INVALID_URL_TEXT };
  const base = `✓ Tarea: ${parsed.taskId} · Grupo: ${parsed.group}`;
  return {
    kind: "valid",
    text: parsed.taskIsKnown ? base : `${base} · te pediremos confirmar la tarea`,
  };
}

/** El error se muestra al salir del campo o al pulsar Enter; la URL válida, al instante. */
export function visibleCheck(check: UrlCheck, touched: boolean): UrlCheck | null {
  if (check.kind === "empty") return null;
  if (check.kind === "invalid" && !touched) return null;
  return check;
}
