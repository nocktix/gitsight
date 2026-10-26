import {
  getRubric,
  getTask,
  createRubricVersion,
  importLocalData,
  listTaskIds,
  putGroups,
  putTask,
} from "../api/dbClient.ts";
import type { ImportCounts, ImportPayload, RubricVersionFull } from "../api/dbClient";

/**
 * Tareas, fechas, rúbricas (versionadas) y grupos viven en la base de datos del backend; las
 * funciones `load*`/`save*`/`add*` de abajo son el único acceso a ellos. En localStorage solo
 * queda `tid.last` (última tarea y grupo abiertos) y el respaldo del estado anterior:
 *
 * - `tid.task.<taskId>`, `tid.tasks`, `tid.analysis.<url>`: formato anterior. Ya no se escriben;
 *   se leen una vez para importarlos al backend (`runMigrationOnce`) y se conservan de respaldo.
 * - `tid.migrated.db.v1`: marca de que esa importación ya se hizo.
 * - `tid.migrated.v1` / `tid.backup.v1`: marca y copia previa de la migración de tareas fantasma.
 *
 * Las funciones `read*`/`write*` de tareas son del formato anterior y solo las usan las
 * migraciones.
 */

const TASK_PREFIX = "tid.task.";
const TASKS_INDEX_KEY = "tid.tasks";
const LAST_KEY = "tid.last";

export interface StoredGroup {
  url: string;
  name: string;
}

export interface TaskData {
  rubric: string | null;
  /** "YYYY-MM-DD" o "" si no se ha definido. */
  startDate: string;
  endDate: string;
  groups: StoredGroup[];
  /** Solo en memoria (en esta sesión): el último grupo abierto de la tarea. */
  lastGroupUrl: string | null;
  /** Versión activa de la rúbrica en el backend (null = sin rúbrica). */
  rubricVersion: number | null;
}

export interface LastOpened {
  taskId: string;
  groupUrl: string;
}

export function emptyTask(): TaskData {
  return {
    rubric: null,
    startDate: "",
    endDate: "",
    groups: [],
    lastGroupUrl: null,
    rubricVersion: null,
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage no disponible (ej. modo privado bloqueado): no persistimos.
  }
}

export function readTask(taskId: string): TaskData {
  const stored = readJson<Partial<TaskData>>(TASK_PREFIX + taskId);
  return { ...emptyTask(), ...stored };
}

export function writeTask(taskId: string, data: TaskData): void {
  writeJson(TASK_PREFIX + taskId, data);
}

export function readTaskIds(): string[] {
  const ids = readJson<string[]>(TASKS_INDEX_KEY);
  return Array.isArray(ids) ? ids : [];
}

export function writeTaskIds(ids: string[]): void {
  writeJson(TASKS_INDEX_KEY, ids);
}

export function readLast(): LastOpened | null {
  const last = readJson<LastOpened>(LAST_KEY);
  return last && last.taskId && last.groupUrl ? last : null;
}

export function writeLast(last: LastOpened): void {
  writeJson(LAST_KEY, last);
}

const MIGRATED_KEY = "tid.migrated.v1";
const BACKUP_KEY = "tid.backup.v1";

/**
 * Una sola vez: las tareas guardadas con el corte por el último guion (ej.
 * "UAICL/tarea02-demo-trio-de") se fusionan en la tarea real ya existente
 * ("UAICL/tarea02-demo"), y sus grupos se recalculan contra ella.
 * La tarea más larga que sea prefijo (+ "-") de otra se considera su fantasma. Deja una copia
 * del estado anterior en `tid.backup.v1`.
 */
export function migrateGhostTasks(): void {
  if (readJson<boolean>(MIGRATED_KEY)) return;
  const ids = readTaskIds();
  const last = readLast();
  writeJson(BACKUP_KEY, {
    ids,
    last,
    tasks: Object.fromEntries(ids.map((id) => [id, readTask(id)])),
  });

  const remaining = new Set(ids);
  // De la más larga a la más corta, para que una cadena de fantasmas se fusione en orden.
  for (const ghost of [...ids].sort((a, b) => b.length - a.length)) {
    const target = ids
      .filter((id) => id !== ghost && ghost.startsWith(`${id}-`))
      .sort((a, b) => b.length - a.length)[0];
    if (!target) continue;

    const prefix = `${target.split("/")[1]}-`;
    const from = readTask(ghost);
    const to = readTask(target);
    const known = new Set(to.groups.map((g) => g.url));
    const moved = from.groups
      .filter((g) => !known.has(g.url))
      .map((g) => {
        const repo = g.url.split("/").pop() ?? "";
        return { url: g.url, name: repo.startsWith(prefix) ? repo.slice(prefix.length) : g.name };
      });
    writeTask(target, {
      rubric: to.rubric ?? from.rubric,
      startDate: to.startDate || from.startDate,
      endDate: to.endDate || from.endDate,
      groups: [...to.groups, ...moved],
      lastGroupUrl: to.lastGroupUrl ?? from.lastGroupUrl,
      rubricVersion: null,
    });
    try {
      localStorage.removeItem(TASK_PREFIX + ghost);
    } catch {
      // sin localStorage no hay nada que migrar.
    }
    remaining.delete(ghost);
    if (last?.taskId === ghost) writeLast({ taskId: target, groupUrl: last.groupUrl });
  }
  writeTaskIds(ids.filter((id) => remaining.has(id)));
  writeJson(MIGRATED_KEY, true);
}

// --- backend --------------------------------------------------------------------------

export function loadTaskIds(): Promise<string[]> {
  return listTaskIds();
}

export async function loadTask(taskId: string): Promise<TaskData> {
  const [task, rubric] = await Promise.all([getTask(taskId), getRubric(taskId)]);
  return {
    ...emptyTask(),
    rubric: rubric?.content ?? null,
    rubricVersion: rubric?.version ?? null,
    startDate: task?.start_date ?? "",
    endDate: task?.end_date ?? "",
    groups: task?.groups ?? [],
  };
}

/** El backend reemplaza ambas fechas, así que siempre se mandan las dos. */
export async function saveTaskDates(
  taskId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  await putTask(taskId, startDate, endDate);
}

/**
 * Sube la rúbrica como versión nueva. Si el texto es igual al de una versión existente, el backend
 * devuelve esa (`created: false`). Con `activate` (por defecto) queda como la activa de la tarea.
 */
export async function saveTaskRubricVersion(
  taskId: string,
  text: string,
  meta: { filename?: string | null; note?: string | null; activate?: boolean } = {},
): Promise<RubricVersionFull & { created: boolean }> {
  return createRubricVersion(taskId, { content: text, ...meta });
}

export async function addTaskGroup(taskId: string, group: StoredGroup): Promise<void> {
  await putGroups(taskId, [group]);
}

// --- migración única de localStorage al backend ----------------------------------------

const MIGRATED_DB_KEY = "tid.migrated.db.v1";
const ANALYSIS_PREFIX = "tid.analysis.";

/** Lo que hay en localStorage con el formato anterior, listo para `POST /api/import`. */
function buildImportPayload(): ImportPayload {
  const payload: ImportPayload = { tasks: {}, analyses: {} };
  for (const id of readTaskIds()) {
    const task = readTask(id);
    payload.tasks[id] = {
      rubric: task.rubric,
      startDate: task.startDate,
      endDate: task.endDate,
      groups: task.groups,
    };
    for (const group of task.groups) {
      const analysis = readJson<ImportPayload["analyses"][string]>(ANALYSIS_PREFIX + group.url);
      if (analysis?.data) payload.analyses[group.url] = analysis;
    }
  }
  return payload;
}

let migration: Promise<ImportCounts | null> | null = null;

/** Para los tests: olvida el resultado de `runMigrationOnce`. */
export function resetMigrationCache(): void {
  migration = null;
}

/**
 * Una sola vez: envía a `POST /api/import` lo que haya en localStorage y marca como migrado
 * solo si el backend respondió bien. No borra nada de localStorage. Devuelve los conteos, o
 * null si no había nada que migrar. Llamadas simultáneas (o repetidas tras un éxito) comparten
 * el mismo resultado; si falla, la siguiente llamada reintenta.
 */
export function runMigrationOnce(): Promise<ImportCounts | null> {
  migration ??= migrate().catch((err: unknown) => {
    migration = null;
    throw err;
  });
  return migration;
}

async function migrate(): Promise<ImportCounts | null> {
  if (readJson<boolean>(MIGRATED_DB_KEY)) return null;
  const payload = buildImportPayload();
  if (Object.keys(payload.tasks).length === 0) {
    writeJson(MIGRATED_DB_KEY, true);
    return null;
  }
  const counts = await importLocalData(payload);
  writeJson(MIGRATED_DB_KEY, true);
  return counts;
}
