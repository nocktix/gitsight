import type { PanelState } from "../context/useAnalysis.ts";
import type { StoredAnalysis } from "./analysisStore.ts";

/**
 * Estado de la vista de un grupo cuando otro proceso (el lote) guardó análisis nuevos de él.
 * Si la vista estaba vacía, con error o leyendo, pasa a mostrar el más reciente; si el evaluador
 * está analizando (`loading`) o ya mira un resultado, no se le cambia lo que ve (el historial sí
 * se actualiza aparte, y el análisis nuevo queda disponible ahí).
 */
export function stateAfterExternalAnalysis(prev: PanelState, saved: StoredAnalysis[]): PanelState {
  if (saved.length === 0) return prev;
  if (prev.status === "idle" || prev.status === "error" || prev.status === "restoring") {
    return { status: "success", viewing: saved[0] };
  }
  return prev;
}
