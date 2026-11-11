import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchAnalysis } from "../api/analyzeClient";
import { scanFolder as scanFolderRequest } from "../api/batchClient";
import type { BatchGroup, BatchScan } from "../api/batchClient";
import { BackendError, BackendUnreachableError } from "../api/http";
import {
  BATCH_CONCURRENCY,
  BATCH_RATE_LIMIT_WAIT_MS,
  INCLUDE_AUTHORSHIP,
  INCLUDE_PROMPT_LOG,
} from "../config";
import { classifyBatchError } from "../utils/batchErrors";
import { runBatch } from "../utils/batchRun";
import type { BatchState } from "../utils/batchRun";
import { friendlyLlmError } from "../utils/llmErrors";
import { llmRequest } from "../utils/llmConfig";
import { BatchContext } from "./useBatch";
import type { BatchStop, BatchValue } from "./useBatch";
import { useLlmConfig } from "./useLlmConfig";
import { useWorkspace } from "./useWorkspace";

const NO_COMMITS = "No se pudo leer el repositorio (dañado o sin commits).";

function stopMessage(err: unknown): string {
  if (err instanceof BackendUnreachableError) {
    return "No se pudo conectar con el backend de GitSight. Revisa que siga encendido y luego presiona «Continuar».";
  }
  if (err instanceof BackendError) return friendlyLlmError(err.code, err.modelAttempted, err.message);
  return err instanceof Error ? err.message : "El análisis se detuvo por un error.";
}

function toStop(err: unknown): BatchStop {
  return { message: stopMessage(err), backendDown: err instanceof BackendUnreachableError };
}

/**
 * Estado del análisis por lote. Vive fuera de BatchPanel (y dentro de WorkspaceProvider) para que
 * el lote siga corriendo al cerrar su ventana o al abrir un grupo; solo "Cancelar" lo detiene.
 */
export function BatchProvider({ children }: { children: ReactNode }) {
  const { openGroup: openWorkspaceGroup, refreshTask } = useWorkspace();
  const { config, language } = useLlmConfig();
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<BatchScan | null>(null);
  const [states, setStates] = useState<BatchState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [stopped, setStopped] = useState<BatchStop | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Si el proveedor se desmonta (cierra la app), no dejar pedidos en vuelo.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const scanFolder = useCallback(async () => {
    setScanning(true);
    setError(null);
    setSummary(null);
    setStopped(null);
    try {
      const result = await scanFolderRequest(folder);
      await refreshTask(result.taskId);
      setScan(result);
      setStates(
        result.groups.map((g) =>
          g.commits === null ? { status: "error", message: NO_COMMITS } : { status: "pending" },
        ),
      );
    } catch (err) {
      setScan(null);
      setStates([]);
      setError(err instanceof Error ? err.message : "No se pudo escanear la carpeta.");
    } finally {
      setScanning(false);
    }
  }, [folder, refreshTask]);

  const analyzeAll = useCallback(async () => {
    if (!scan || !config || controllerRef.current) return;
    const { llm, apiKey } = llmRequest(config);
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setSummary(null);
    setStopped(null);
    try {
      // Fechas y rúbrica son las de la tarea; sin versión explícita el backend usa la activa.
      const task = await refreshTask(scan.taskId);
      // Solo se analizan los que no están listos; los que fallaron antes se reintentan.
      const queue = scan.groups
        .map((group, index) => ({ group, index }))
        .filter(
          ({ group, index }) => group.commits !== null && states[index]?.status !== "done",
        );
      const inQueue = new Set(queue.map((q) => q.index));
      setStates((prev) => prev.map((s, i) => (inQueue.has(i) ? { status: "pending" } : s)));

      const result = await runBatch(
        queue,
        ({ group }, signal) =>
          fetchAnalysis(
            {
              repo_path: group.path,
              group_url: group.url,
              include_prompt_log: INCLUDE_PROMPT_LOG,
              include_authorship: INCLUDE_AUTHORSHIP,
              task_id: scan.taskId,
              llm,
              language,
              ...(task.startDate ? { task_start: task.startDate } : {}),
              ...(task.endDate ? { task_deadline: task.endDate } : {}),
            },
            apiKey,
            signal,
          ).then(() => undefined),
        {
          signal: controller.signal,
          concurrency: BATCH_CONCURRENCY,
          rateLimitWaitMs: BATCH_RATE_LIMIT_WAIT_MS,
          classify: classifyBatchError,
          onStatus: (i, state) =>
            setStates((prev) => prev.map((s, k) => (k === queue[i].index ? state : s))),
        },
      );
      if (result.stopped) setStopped(toStop(result.stopped.error));
      setSummary(
        `${result.cancelled ? "Cancelado. " : result.stopped ? "Detenido. " : ""}` +
          `${result.done} analizados` +
          (result.failed > 0 ? `, ${result.failed} con error` : "") +
          ".",
      );
    } catch (err) {
      // Falló antes de lanzar el primer grupo (p. ej. no se pudo leer la tarea).
      setStopped(toStop(err));
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }, [scan, states, config, language, refreshTask]);

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const openGroup = useCallback(
    async (group: BatchGroup) => {
      if (scan && (await openWorkspaceGroup(group.url, scan.taskId))) setDialogOpen(false);
    },
    [scan, openWorkspaceGroup],
  );

  const value = useMemo<BatchValue>(() => {
    const readable = (i: number) => scan?.groups[i]?.commits !== null;
    const analyzable = scan ? scan.groups.filter((g) => g.commits !== null).length : 0;
    const finished = states.filter(
      (s, i) => readable(i) && (s.status === "done" || s.status === "error"),
    ).length;
    const done = states.filter((s, i) => readable(i) && s.status === "done").length;
    const remaining = analyzable - done;
    return {
      folder,
      setFolder,
      scan,
      states,
      scanning,
      running,
      error,
      summary,
      stopped,
      analyzable,
      finished,
      remaining,
      canContinue: (done > 0 || stopped !== null) && remaining > 0,
      scanFolder,
      analyzeAll,
      cancel,
      openGroup,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
    };
  }, [
    folder, scan, states, scanning, running, error, summary, stopped, dialogOpen,
    scanFolder, analyzeAll, cancel, openGroup,
  ]);

  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}
