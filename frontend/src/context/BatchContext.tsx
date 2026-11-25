import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchAnalysis } from "../api/analyzeClient";
import { scanFolder as scanFolderRequest } from "../api/batchClient";
import { listRubricVersions } from "../api/dbClient";
import type { BatchGroup, BatchScan } from "../api/batchClient";
import { BackendError, BackendUnreachableError } from "../api/http";
import {
  BATCH_CONCURRENCY,
  BATCH_RATE_LIMIT_WAIT_MS,
  INCLUDE_AUTHORSHIP,
  INCLUDE_PROMPT_LOG,
} from "../config";
import { classifyBatchError } from "../utils/batchErrors";
import { MODEL_SAVED_NOTICE, RUBRIC_SAVED_NOTICE, gateAnalyze } from "../utils/batchGate";
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
  const { openGroup: openWorkspaceGroup, refreshTask, saveRubric } = useWorkspace();
  const { config, language, openSettings, settingsOpen } = useLlmConfig();
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<BatchScan | null>(null);
  const [states, setStates] = useState<BatchState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [stopped, setStopped] = useState<BatchStop | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [noRubricPrompt, setNoRubricPrompt] = useState(false);
  const [rubricEditorOpen, setRubricEditorOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** El corrector pidió analizar sin modelo: al guardarlo se le avisa, pero el lote no parte solo. */
  const [awaitingModel, setAwaitingModel] = useState(false);
  /** El editor de rúbrica se abrió desde el diálogo "Esta tarea no tiene rúbrica". */
  const [editorFromPrompt, setEditorFromPrompt] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Si el proveedor se desmonta (cierra la app), no dejar pedidos en vuelo.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const scanFolder = useCallback(async () => {
    setScanning(true);
    setError(null);
    setSummary(null);
    setStopped(null);
    setNotice(null);
    setAwaitingModel(false);
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

  const runAll = useCallback(async () => {
    if (!scan || !config || controllerRef.current) return;
    setNotice(null);
    setAwaitingModel(false);
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

  const requestAnalyze = useCallback(async () => {
    if (!scan || controllerRef.current || checking) return;
    setNotice(null);
    setAwaitingModel(false);
    if (!config) {
      setAwaitingModel(true);
      openSettings();
      return;
    }
    // La rúbrica activa se consulta ahora (no se confía en un valor viejo): pudo cambiar.
    setChecking(true);
    let hasRubric: boolean;
    try {
      hasRubric = (await listRubricVersions(scan.taskId)).some((v) => v.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo comprobar la rúbrica de la tarea.");
      return;
    } finally {
      setChecking(false);
    }
    if (gateAnalyze({ hasModel: true, hasRubric }) === "need-rubric") setNoRubricPrompt(true);
    else void runAll();
  }, [scan, config, checking, openSettings, runAll]);

  const analyzeWithoutRubric = useCallback(() => {
    setNoRubricPrompt(false);
    void runAll();
  }, [runAll]);

  const addRubricFromPrompt = useCallback(() => {
    setNoRubricPrompt(false);
    setEditorFromPrompt(true);
    setRubricEditorOpen(true);
  }, []);

  // Mientras el lote corre no se cambia la rúbrica: el backend usa la activa en cada análisis.
  const openRubricEditor = useCallback(() => {
    if (controllerRef.current) return;
    setEditorFromPrompt(false);
    setRubricEditorOpen(true);
  }, []);
  const closeRubricEditor = useCallback(() => setRubricEditorOpen(false), []);

  const saveBatchRubric = useCallback(
    async (value: { text: string; filename: string | null; note: string | null }) => {
      if (!scan || controllerRef.current) return false;
      const saved = await saveRubric(
        value.text,
        { filename: value.filename, note: value.note },
        scan.taskId,
      );
      if (saved === null) return false;
      setRubricEditorOpen(false);
      if (editorFromPrompt) setNotice(RUBRIC_SAVED_NOTICE);
      setEditorFromPrompt(false);
      return true;
    },
    [scan, saveRubric, editorFromPrompt],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const openGroup = useCallback(
    async (group: BatchGroup) => {
      if (scan && (await openWorkspaceGroup(group.url, scan.taskId))) setDialogOpen(false);
    },
    [scan, openWorkspaceGroup],
  );

  // Tras guardar el modelo que se pidió al presionar el botón, se invita a presionarlo otra vez.
  const modelSaved = awaitingModel && !settingsOpen && config !== null;
  const shownNotice = notice ?? (modelSaved ? MODEL_SAVED_NOTICE : null);

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
      requestAnalyze,
      checking,
      noRubricPrompt,
      closeNoRubricPrompt: () => setNoRubricPrompt(false),
      analyzeWithoutRubric,
      addRubricFromPrompt,
      rubricEditorOpen,
      openRubricEditor,
      closeRubricEditor,
      saveBatchRubric,
      notice: shownNotice,
      cancel,
      openGroup,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
    };
  }, [
    folder, scan, states, scanning, running, error, summary, stopped, dialogOpen,
    scanFolder, requestAnalyze, checking, noRubricPrompt, analyzeWithoutRubric,
    addRubricFromPrompt, rubricEditorOpen, openRubricEditor, closeRubricEditor,
    saveBatchRubric, shownNotice, cancel, openGroup,
  ]);

  return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}
