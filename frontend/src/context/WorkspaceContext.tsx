import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { fetchCommits } from "../api/commitsClient";
import { activateRubricVersion } from "../api/dbClient";
import type { ImportCounts } from "../api/dbClient";
import { parseRepoUrl } from "../utils/repoUrl";
import type { ParsedRepo } from "../utils/repoUrl";
import {
  addTaskGroup,
  emptyTask,
  loadTask,
  loadTaskIds,
  migrateGhostTasks,
  readLast,
  runMigrationOnce,
  saveTaskDates,
  saveTaskRubricVersion,
  writeLast,
} from "../utils/storage";
import type { TaskData } from "../utils/storage";
import { WorkspaceContext } from "./useWorkspace";
import type { CommitsState, WorkspaceValue } from "./useWorkspace";

/** Parsea "YYYY-MM-DD" (input type=date) como fecha local, sin desfases de timezone. */
function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}


function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "No se pudo descargar el repositorio.";
}

function backendErrorText(err: unknown): string {
  return err instanceof Error ? err.message : "No se pudo conectar con el backend";
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const tasksRef = useRef<Record<string, TaskData>>({});
  const taskIdsRef = useRef<string[]>([]);
  const [tasks, setTasks] = useState<Record<string, TaskData>>({});
  const [taskIds, setTaskIds] = useState<string[]>([]);

  const [backendStatus, setBackendStatus] = useState<"loading" | "ready" | "error">("loading");
  const [backendError, setBackendError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [migration, setMigration] = useState<ImportCounts | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const [active, setActive] = useState<ParsedRepo | null>(null);
  const [commits, setCommits] = useState<CommitsState>({ status: "loading" });
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  /** Cambia la tarea en memoria; guardarla en el backend es cosa de quien llama. */
  const updateTask = useCallback((taskId: string, change: (t: TaskData) => TaskData) => {
    const next = change(tasksRef.current[taskId] ?? emptyTask());
    tasksRef.current = { ...tasksRef.current, [taskId]: next };
    setTasks(tasksRef.current);
    if (!taskIdsRef.current.includes(taskId)) {
      taskIdsRef.current = [...taskIdsRef.current, taskId];
      setTaskIds(taskIdsRef.current);
    }
  }, []);

  const loadedUrls = useCallback(
    () => Object.values(tasksRef.current).flatMap((t) => t.groups.map((g) => g.url)),
    [],
  );

  /** Descarga el repo (clona en el backend) y, si sale bien, lo hace el grupo activo. */
  const load = useCallback(
    async (
      input: string,
      isInitialLoad: boolean,
      forcedTaskId?: string,
    ): Promise<boolean> => {
      const detected = parseRepoUrl(input, taskIdsRef.current, undefined, loadedUrls());
      if (!detected) {
        setOpenError("Esta URL no parece ser un repositorio de GitHub");
        return false;
      }
      // Un grupo ya guardado conserva la tarea con la que se guardó.
      const savedTaskId = Object.entries(tasksRef.current).find(([, t]) =>
        t.groups.some((g) => g.url === detected.url),
      )?.[0];
      const forced = forcedTaskId ?? savedTaskId;
      const parsed = forced ? parseRepoUrl(input, [], forced) : detected;
      if (!parsed) {
        setOpenError(
          "El identificador de la tarea debe ser el comienzo del nombre del repositorio.",
        );
        return false;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setPendingUrl(parsed.url);
      setOpenError(null);

      try {
        const data = await fetchCommits(parsed.url, controller.signal);
        const group = { url: parsed.url, name: parsed.group };
        if (!tasksRef.current[parsed.taskId]?.groups.some((g) => g.url === parsed.url)) {
          // Primero el backend: si no se guarda, el grupo no queda como abierto.
          await addTaskGroup(parsed.taskId, group);
        }
        updateTask(parsed.taskId, (t) => ({
          ...t,
          groups: t.groups.some((g) => g.url === parsed.url) ? t.groups : [...t.groups, group],
          lastGroupUrl: parsed.url,
        }));
        writeLast({ taskId: parsed.taskId, groupUrl: parsed.url });
        setActive(parsed);
        setCommits({ status: "success", data, loadedAt: new Date() });
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        if (isInitialLoad) {
          setCommits({ status: "error", message: errorText(err) });
        } else {
          setOpenError(errorText(err));
        }
        return false;
      } finally {
        if (controllerRef.current === controller) setPendingUrl(null);
      }
    },
    [updateTask, loadedUrls],
  );

  const openGroup = useCallback(
    (url: string, taskId?: string) => load(url, false, taskId),
    [load],
  );
  const detectTask = useCallback(
    (url: string) => parseRepoUrl(url, taskIdsRef.current, undefined, loadedUrls()),
    [loadedUrls],
  );

  // Al iniciar: migración única de localStorage, lectura de las tareas del backend y recarga
  // del último grupo abierto (los datos de commits no se guardan). Si el backend no responde
  // no se muestra nada de trabajo: ver `backendStatus`.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        migrateGhostTasks();
        const counts = await runMigrationOnce();
        const ids = await loadTaskIds();
        const entries = await Promise.all(ids.map(async (id) => [id, await loadTask(id)] as const));
        if (cancelled) return;
        tasksRef.current = Object.fromEntries(entries);
        taskIdsRef.current = ids;
        setTasks(tasksRef.current);
        setTaskIds(ids);
        setMigration(counts);
        // La tarea guardada manda: el evaluador pudo haberla corregido al cargar el grupo.
        const last = readLast();
        const initial = last ? parseRepoUrl(last.groupUrl, [], last.taskId) : null;
        setActive(initial);
        setBackendStatus("ready");
        if (initial) void load(initial.url, true);
      } catch (err) {
        if (cancelled) return;
        setBackendError(backendErrorText(err));
        setBackendStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [attempt, load]);

  const retryBackend = useCallback(() => {
    setBackendStatus("loading");
    setBackendError(null);
    setAttempt((n) => n + 1);
  }, []);
  const dismissMigration = useCallback(() => setMigration(null), []);
  const dismissWriteError = useCallback(() => setWriteError(null), []);

  const task = active ? (tasks[active.taskId] ?? emptyTask()) : emptyTask();

  const switchTask = useCallback(
    (taskId: string) => {
      const target = tasksRef.current[taskId];
      const url = target?.lastGroupUrl ?? target?.groups[0]?.url;
      if (url) void load(url, false);
    },
    [load],
  );

  const activeTaskId = active?.taskId;
  /** Cambia una fecha y la guarda; si el backend falla se restaura la anterior y se avisa. */
  const changeDate = useCallback(
    (key: "startDate" | "endDate", value: string) => {
      if (!activeTaskId) return;
      const previous = (tasksRef.current[activeTaskId] ?? emptyTask())[key];
      updateTask(activeTaskId, (t) => ({ ...t, [key]: value }));
      const { startDate, endDate } = tasksRef.current[activeTaskId];
      saveTaskDates(activeTaskId, startDate, endDate).catch((err: unknown) => {
        updateTask(activeTaskId, (t) => ({ ...t, [key]: previous }));
        setWriteError(backendErrorText(err));
      });
    },
    [activeTaskId, updateTask],
  );
  const setStartDate = useCallback((value: string) => changeDate("startDate", value), [changeDate]);
  const setEndDate = useCallback((value: string) => changeDate("endDate", value), [changeDate]);
  const [rubricRevision, setRubricRevision] = useState(0);
  const saveRubric = useCallback<WorkspaceValue["saveRubric"]>(
    async (text, meta) => {
      if (!activeTaskId) return null;
      try {
        const saved = await saveTaskRubricVersion(activeTaskId, text, meta);
        if (saved.active) {
          updateTask(activeTaskId, (t) => ({ ...t, rubric: saved.content, rubricVersion: saved.version }));
        }
        setRubricRevision((n) => n + 1);
        return { version: saved.version, created: saved.created };
      } catch (err) {
        setWriteError(backendErrorText(err));
        return null;
      }
    },
    [activeTaskId, updateTask],
  );
  const activateRubric = useCallback(
    async (version: number): Promise<boolean> => {
      if (!activeTaskId) return false;
      try {
        const activated = await activateRubricVersion(activeTaskId, version);
        updateTask(activeTaskId, (t) => ({
          ...t,
          rubric: activated.content,
          rubricVersion: activated.version,
        }));
        setRubricRevision((n) => n + 1);
        return true;
      } catch (err) {
        setWriteError(backendErrorText(err));
        return false;
      }
    },
    [activeTaskId, updateTask],
  );

  const { taskStart, taskEnd, datesError } = useMemo(() => {
    const start = parseDateInput(task.startDate);
    const end = parseDateInput(task.endDate);
    if (start && end && end.getTime() < start.getTime()) {
      return {
        taskStart: null,
        taskEnd: null,
        datesError: "La fecha de entrega debe ser igual o posterior al inicio de la tarea.",
      };
    }
    return { taskStart: start, taskEnd: end, datesError: null };
  }, [task.startDate, task.endDate]);

  const value: WorkspaceValue = {
    active,
    commits,
    taskIds,
    groups: task.groups,
    task,
    pendingUrl,
    openError,
    openGroup,
    detectTask,
    switchTask,
    setStartDate,
    setEndDate,
    taskStart,
    taskEnd,
    datesError,
    saveRubric,
    activateRubric,
    rubricRevision,
    backendStatus,
    backendError,
    retryBackend,
    migration,
    dismissMigration,
    writeError,
    dismissWriteError,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
