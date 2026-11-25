import { createContext, useContext } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { RubricSubmit } from "../components/RubricField";
import type { StoredAnalysis } from "../utils/analysisStore";
import type { ArtifactPresence } from "../utils/emptyStates";

export type PanelState =
  | { status: "restoring" } // leyendo el último análisis guardado en el backend
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      /** Si el error viene del LLM: código, modelo que falló y datos para reintentar. */
      llm?: {
        code: string | null;
        failedModel: string | null;
        rubricVersion: number | null;
      };
    }
  | { status: "success"; viewing: StoredAnalysis };

export interface AnalysisValue {
  state: PanelState;
  setState: Dispatch<SetStateAction<PanelState>>;
  /** Análisis del grupo, el más reciente primero. */
  history: StoredAnalysis[];
  /** Editando la rúbrica de la tarea (independiente del resultado mostrado). */
  editing: boolean;
  setEditing: (editing: boolean) => void;
  rubricInfo: string | null;
  /** Configuración de la tarea: true/false si el evaluador la abrió o cerró; null = según lo que falte. */
  configOpen: boolean | null;
  setConfigOpen: (open: boolean | null) => void;
  /** Qué archivos del repo existen (bitácora y autoría); null mientras se consulta. */
  presence: ArtifactPresence[] | null;
  /** `rubricVersion` null: el backend usa la versión activa de la tarea (o ninguna si no hay). */
  runAnalysis: (rubricVersion: number | null) => void;
  /** Guarda una versión nueva de la rúbrica sin analizar; devuelve su número o null si no se guardó. */
  saveRubricVersion: (submit: RubricSubmit) => Promise<number | null>;
}

export const AnalysisContext = createContext<AnalysisValue | null>(null);

export function useAnalysis(): AnalysisValue {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis debe usarse dentro de AnalysisProvider");
  return ctx;
}
