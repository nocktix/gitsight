import type { AnalyzeResponse } from "../types/analyze";
import { backendFetch, errorFromResponse } from "./http.ts";

/** Cliente de los endpoints de persistencia del backend (app/routes_db.py). */

export interface DbGroup {
  url: string;
  name: string;
}

export interface DbTask {
  id: string;
  start_date: string | null;
  end_date: string | null;
  groups: DbGroup[];
}

/** Un criterio reconocido en el texto de una rúbrica. */
export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
}

/** Versión de la rúbrica de una tarea. `content` y `criteria` solo vienen al pedir el detalle. */
export interface RubricVersion {
  task_id: string;
  version: number;
  created_at: string;
  /** Archivo original; null si se pegó el texto o la versión es anterior a este registro. */
  filename: string | null;
  note: string | null;
  /** La que usan los análisis nuevos de todos los grupos de la tarea. */
  active: boolean;
  /** null si la rúbrica no tiene criterios reconocibles. */
  criteria_count: number | null;
  content?: string;
  criteria?: RubricCriterion[] | null;
}

export type RubricVersionFull = RubricVersion & { content: string };

export interface RubricComparison {
  /** false: no hay criterios reconocibles en alguna de las dos; solo se comparan los textos. */
  structured: boolean;
  from: RubricVersionFull;
  to: RubricVersionFull;
  added: RubricCriterion[];
  removed: RubricCriterion[];
  modified: {
    id: string;
    before: RubricCriterion;
    after: RubricCriterion;
    changed: ("id" | "title" | "description")[];
  }[];
  unchanged: number;
}

/** Cómo quedó la rúbrica de un análisis: versión concreta, sin rúbrica o no identificable. */
export type RubricState = "version" | "none" | "unknown";

export interface DbAnalysis {
  id: number;
  task_id: string;
  group_url: string;
  rubric_version: number | null;
  rubric_state: RubricState;
  model: string;
  head_commit: string | null;
  created_at: string;
  result: AnalyzeResponse;
}

/** Forma de lo que guardaba localStorage (`tid.task.*` y `tid.analysis.*`). */
export interface ImportPayload {
  tasks: Record<
    string,
    { rubric: string | null; startDate: string; endDate: string; groups: DbGroup[] }
  >;
  analyses: Record<string, { data: AnalyzeResponse; rubric: string | null }>;
}

export interface ImportCounts {
  tasks: number;
  rubrics: number;
  groups: number;
  analyses: number;
  analyses_skipped_duplicate: number;
  analyses_skipped_unknown_group: string[];
}

/** "owner/nombre" -> ruta segura; el backend recibe el id como dos segmentos. */
function taskPath(taskId: string): string {
  return `/api/tasks/${taskId.split("/").map(encodeURIComponent).join("/")}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

function send(method: string, path: string, body: unknown): Promise<Response> {
  return backendFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listTaskIds(): Promise<string[]> {
  return json(await backendFetch("/api/tasks"));
}

/** null si la tarea todavía no existe en el backend. */
export async function getTask(taskId: string): Promise<DbTask | null> {
  const res = await backendFetch(taskPath(taskId));
  return res.status === 404 ? null : json(res);
}

export async function putTask(
  taskId: string,
  startDate: string,
  endDate: string,
): Promise<DbTask> {
  return json(await send("PUT", taskPath(taskId), { start_date: startDate, end_date: endDate }));
}

export async function putGroups(taskId: string, groups: DbGroup[]): Promise<DbTask> {
  return json(await send("PUT", `${taskPath(taskId)}/groups`, { groups }));
}

/** Versión activa de la rúbrica (con su texto); null si la tarea no tiene. */
export async function getRubric(taskId: string): Promise<RubricVersionFull | null> {
  const res = await backendFetch(`${taskPath(taskId)}/rubric`);
  return res.status === 404 ? null : json(res);
}

/** Todas las versiones de la tarea, la más reciente primero (sin el texto). */
export async function listRubricVersions(taskId: string): Promise<RubricVersion[]> {
  return json(await backendFetch(`${taskPath(taskId)}/rubric/versions`));
}

export async function getRubricVersion(taskId: string, version: number): Promise<RubricVersionFull> {
  return json(await backendFetch(`${taskPath(taskId)}/rubric/versions/${version}`));
}

/**
 * Sube una versión nueva (nunca sobrescribe). Si el texto es igual al de alguna versión existente
 * el backend devuelve esa (`created: false`) en vez de duplicarla.
 */
export async function createRubricVersion(
  taskId: string,
  body: { content: string; filename?: string | null; note?: string | null; activate?: boolean },
): Promise<RubricVersionFull & { created: boolean }> {
  return json(await send("POST", `${taskPath(taskId)}/rubric/versions`, body));
}

/** La versión pasa a usarse en los próximos análisis de todos los grupos de la tarea. */
export async function activateRubricVersion(
  taskId: string,
  version: number,
): Promise<RubricVersionFull> {
  return json(await send("POST", `${taskPath(taskId)}/rubric/versions/${version}/activate`, {}));
}

export async function compareRubricVersions(
  taskId: string,
  from: number,
  to: number,
): Promise<RubricComparison> {
  return json(await backendFetch(`${taskPath(taskId)}/rubric/compare?from=${from}&to=${to}`));
}

/** Análisis del grupo, el más reciente primero. */
export async function getAnalyses(groupUrl: string): Promise<DbAnalysis[]> {
  return json(await backendFetch(`/api/analyses?group_url=${encodeURIComponent(groupUrl)}`));
}

export async function importLocalData(payload: ImportPayload): Promise<ImportCounts> {
  return json(await send("POST", "/api/import", payload));
}
