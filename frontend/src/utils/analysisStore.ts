import { getAnalyses } from "../api/dbClient.ts";
import type { RubricState } from "../api/dbClient.ts";
import type { AnalyzeResponse } from "../types/analyze";

/**
 * Análisis de cada grupo, leídos del backend. Guardarlos no está aquí: `/api/analyze` guarda
 * uno nuevo cada vez que recibe `task_id`, y nunca reemplaza uno anterior.
 */

export interface StoredAnalysis {
  /** Id en la base; -1 si el backend no devolvió la fila (el resultado solo está en pantalla). */
  id: number;
  data: AnalyzeResponse;
  model: string;
  /** Versión de la rúbrica con la que se hizo; null si no hay (ver `rubricState`). */
  rubricVersion: number | null;
  /** "none": se hizo sin rúbrica; "unknown": usó una, pero no se sabe cuál. */
  rubricState: RubricState;
  /** Hash completo del último commit al analizar; null en los análisis importados. */
  headCommit: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
}

/** Todos los análisis del grupo, el más reciente primero. */
export async function loadAnalysisHistory(groupUrl: string): Promise<StoredAnalysis[]> {
  const rows = await getAnalyses(groupUrl);
  return rows.map((row) => ({
    id: row.id,
    data: row.result,
    model: row.model,
    rubricVersion: row.rubric_version,
    rubricState: row.rubric_state,
    headCommit: row.head_commit,
    createdAt: row.created_at,
  }));
}
