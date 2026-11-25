import type { RubricVersion } from "../api/dbClient";
import { formatSantiago } from "./analysisHistory.ts";

/** Qué hacer al presionar "Analizar todos" (o "Continuar con N pendientes"). */
export type AnalyzeGate = "need-model" | "need-rubric" | "go";

/**
 * Sin modelo no se parte (se abre la configuración); con modelo pero sin rúbrica activa se
 * pregunta; con ambos se parte sin diálogos extra.
 */
export function gateAnalyze(input: { hasModel: boolean; hasRubric: boolean }): AnalyzeGate {
  if (!input.hasModel) return "need-model";
  if (!input.hasRubric) return "need-rubric";
  return "go";
}

export const NO_RUBRIC_TEXT = "Esta tarea no tiene rúbrica";
export const NO_RUBRIC_WARNING =
  "Esta tarea no tiene rúbrica. Los hallazgos no se organizarán por criterio.";
export const RUBRIC_LOCKED_TEXT = "No se puede cambiar la rúbrica mientras se analiza el lote";
export const MODEL_SAVED_NOTICE = "Modelo guardado. Presiona Analizar todos para empezar.";
export const RUBRIC_SAVED_NOTICE = "Rúbrica guardada. Presiona Analizar todos para empezar.";
export const LOCAL_TASK_NOTE =
  "Esta tarea es local: la rúbrica no se compartirá con grupos abiertos por URL.";

/** Las tareas sin origin de GitHub (o con owners distintos) se llaman `local/prefijo`. */
export function isLocalTask(taskId: string): boolean {
  return taskId.startsWith("local/");
}

export type RubricBlockState =
  | { kind: "none" }
  | { kind: "active"; version: number; label: string };

/** "Versión 2 activa · rubrica.pdf" (o la fecha en hora de Chile si se pegó el texto). */
export function rubricBlockState(versions: RubricVersion[]): RubricBlockState {
  const active = versions.find((v) => v.active);
  if (!active) return { kind: "none" };
  return {
    kind: "active",
    version: active.version,
    label: `Versión ${active.version} activa · ${active.filename ?? formatSantiago(active.created_at)}`,
  };
}

/**
 * Qué se puede hacer con la rúbrica desde el lote. Mientras el lote corre no se agrega ni se
 * cambia (el backend usa la versión activa en cada análisis y los grupos quedarían con versiones
 * distintas); "Ver" sigue disponible.
 */
export function rubricActions(running: boolean): {
  canView: true;
  canAdd: boolean;
  canChange: boolean;
  lockedText: string | null;
} {
  return {
    canView: true,
    canAdd: !running,
    canChange: !running,
    lockedText: running ? RUBRIC_LOCKED_TEXT : null,
  };
}
