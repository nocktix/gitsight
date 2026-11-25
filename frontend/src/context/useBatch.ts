import { createContext, useContext } from "react";
import type { BatchGroup, BatchScan } from "../api/batchClient";
import type { BatchState } from "../utils/batchRun";

/** Por qué se detuvo el lote (mensaje en lenguaje simple). */
export interface BatchStop {
  message: string;
  /** El backend de GitSight no responde: se arregla encendiéndolo, no con la configuración de IA. */
  backendDown: boolean;
}

export interface BatchValue {
  folder: string;
  setFolder: (value: string) => void;
  /** Resultado del último escaneo; null hasta que se escanea una carpeta. */
  scan: BatchScan | null;
  states: BatchState[];
  scanning: boolean;
  running: boolean;
  error: string | null;
  summary: string | null;
  stopped: BatchStop | null;
  /** Cuántos análisis ha terminado el lote por grupo (url); sube cuando un grupo queda analizado. */
  analyzedGroups: Record<string, number>;

  /** Grupos con commits legibles (los que se pueden analizar). */
  analyzable: number;
  /** Terminados (listos o con error) entre los analizables. */
  finished: number;
  /** Analizables que todavía no están listos (pendientes o con error). */
  remaining: number;
  /** Hay grupos listos y quedan otros por analizar: el botón dice "Continuar". */
  canContinue: boolean;

  scanFolder: () => Promise<void>;
  /**
   * "Analizar todos" / "Continuar": primero verifica el modelo y la rúbrica. Sin modelo abre la
   * configuración; sin rúbrica pregunta; con ambos parte el lote.
   */
  requestAnalyze: () => Promise<void>;
  /** Se está comprobando la rúbrica de la tarea (unos instantes tras presionar el botón). */
  checking: boolean;
  /** Diálogo "Esta tarea no tiene rúbrica". */
  noRubricPrompt: boolean;
  closeNoRubricPrompt: () => void;
  /** Del diálogo: parte el lote sin rúbrica. */
  analyzeWithoutRubric: () => void;
  /** Del diálogo: abre el editor de rúbrica del bloque "Rúbrica de la tarea". */
  addRubricFromPrompt: () => void;
  /** Editor de rúbrica del bloque (agregar o cambiar). */
  rubricEditorOpen: boolean;
  openRubricEditor: () => void;
  closeRubricEditor: () => void;
  /** Guarda la rúbrica como versión nueva de la tarea escaneada, sin analizar. true si se guardó. */
  saveBatchRubric: (value: {
    text: string;
    filename: string | null;
    note: string | null;
  }) => Promise<boolean>;
  /** Aviso que invita a presionar "Analizar todos" (tras guardar el modelo o la rúbrica). */
  notice: string | null;
  cancel: () => void;
  /** Abre un grupo del lote en la pantalla principal; cierra la ventana del lote. */
  openGroup: (group: BatchGroup) => Promise<void>;

  /** Ventana del lote (la de la barra superior y el botón "Tarea completa"). */
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const BatchContext = createContext<BatchValue | null>(null);

export function useBatch(): BatchValue {
  const ctx = useContext(BatchContext);
  if (!ctx) throw new Error("useBatch debe usarse dentro de BatchProvider");
  return ctx;
}
