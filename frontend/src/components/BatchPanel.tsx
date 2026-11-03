import { useEffect, useRef, useState } from "react";
import { fetchAnalysis } from "../api/analyzeClient";
import { scanFolder } from "../api/batchClient";
import type { BatchGroup, BatchScan } from "../api/batchClient";
import { INCLUDE_AUTHORSHIP, INCLUDE_PROMPT_LOG } from "../config";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import { runBatch } from "../utils/batchRun";
import type { BatchState } from "../utils/batchRun";
import { llmRequest } from "../utils/llmConfig";
import LlmNotConfigured from "./LlmNotConfigured";
import "./BatchPanel.css";

const STATUS_TEXT: Record<BatchState["status"], string> = {
  pending: "Pendiente",
  running: "Analizando…",
  done: "Listo",
  error: "Error",
};

/** "Tarea completa": escanea una carpeta descargada con `gh teacher download` y analiza cada repo. */
export default function BatchPanel({ onGroupOpened }: { onGroupOpened?: () => void }) {
  const { openGroup, refreshTask, pendingUrl, openError } = useWorkspace();
  const { config, language } = useLlmConfig();
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<BatchScan | null>(null);
  const [states, setStates] = useState<BatchState[]>([]);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Cerrar el panel (o el modal) a mitad de un lote cancela el análisis en curso.
  useEffect(() => () => controllerRef.current?.abort(), []);

  async function submitScan() {
    setScanning(true);
    setError(null);
    setSummary(null);
    try {
      const result = await scanFolder(folder);
      await refreshTask(result.taskId);
      setScan(result);
      setStates(
        result.groups.map((g) =>
          g.commits === null ? { status: "error", message: NO_COMMITS } : { status: "pending" },
        ),
      );
    } catch (err) {
      setScan(null);
      setError(err instanceof Error ? err.message : "No se pudo escanear la carpeta.");
    } finally {
      setScanning(false);
    }
  }

  async function openAndNotify(group: BatchGroup) {
    if (scan && (await openGroup(group.url, scan.taskId))) onGroupOpened?.();
  }

  async function analyzeAll() {
    if (!scan || !config) return;
    const { llm, apiKey } = llmRequest(config);
    // Fechas y rúbrica son las de la tarea; sin versión explícita el backend usa la activa.
    const task = await refreshTask(scan.taskId);
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setSummary(null);
    const queue = scan.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group, index }) => group.commits !== null && states[index].status !== "done");
    // Los que fallaron en una corrida anterior se reintentan.
    setStates((prev) =>
      prev.map((s, i) =>
        s.status === "error" && scan.groups[i].commits !== null ? { status: "pending" } : s,
      ),
    );

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
        onStatus: (i, state) =>
          setStates((prev) => prev.map((s, k) => (k === queue[i].index ? state : s))),
      },
    );
    setRunning(false);
    setSummary(
      `${result.cancelled ? "Cancelado. " : ""}${result.done} analizados` +
        (result.failed > 0 ? `, ${result.failed} con error` : "") +
        ".",
    );
  }

  const readable = (i: number) => scan?.groups[i].commits !== null;
  const analyzable = scan ? scan.groups.filter((g) => g.commits !== null).length : 0;
  const finished = states.filter(
    (s, i) => readable(i) && (s.status === "done" || s.status === "error"),
  ).length;

  return (
    <div className="batch">
      <p className="welcome__instruction">
        Pega la ruta de la carpeta que descargaste con <code>gh teacher download</code>. Cada
        subcarpeta es el repositorio de un grupo.
      </p>
      <form
        className="batch__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (folder.trim() && !scanning && !running) void submitScan();
        }}
      >
        <input
          aria-label="Ruta de la carpeta con los repositorios"
          className="welcome__input"
          disabled={scanning || running}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="/Users/tu-usuario/Descargas/classroom50-tarea01"
          type="text"
          value={folder}
        />
        <button className="welcome__button" disabled={scanning || running || !folder.trim()} type="submit">
          {scanning ? "Escaneando…" : "Escanear carpeta"}
        </button>
      </form>
      {error && <p className="welcome__error">{error}</p>}

      {scan && (
        <>
          <p className="batch__task">
            Tarea: <strong>{scan.taskId}</strong> · {scan.groups.length} grupos
          </p>
          {scan.warnings.map((w) => (
            <p className="batch__warning" key={w} role="status">
              {w}
            </p>
          ))}
          <table className="batch__table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Commits</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {scan.groups.map((g, i) => (
                <tr key={g.url}>
                  <td>{g.name}</td>
                  <td>{g.commits ?? "—"}</td>
                  <td className={`batch__status batch__status--${states[i].status}`}>
                    {STATUS_TEXT[states[i].status]}
                    {states[i].status === "error" && (
                      <span className="batch__message">{(states[i] as { message: string }).message}</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="batch__open"
                      disabled={!g.hasOrigin || running || !!pendingUrl}
                      onClick={() => void openAndNotify(g)}
                      title={g.hasOrigin ? undefined : "Sin origin de GitHub: solo se puede analizar en lote."}
                      type="button"
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!config && <LlmNotConfigured className="welcome__error" />}
          {running && (
            <progress aria-label="Progreso del análisis" max={analyzable} value={finished} />
          )}
          <div className="batch__actions">
            <button
              className="welcome__button"
              disabled={!config || running || analyzable === 0}
              onClick={() => void analyzeAll()}
              type="button"
            >
              Analizar todos
            </button>
            {running && (
              <button className="batch__cancel" onClick={() => controllerRef.current?.abort()} type="button">
                Cancelar
              </button>
            )}
            {running && (
              <span className="batch__count">
                {finished} de {analyzable}
              </span>
            )}
          </div>
          {summary && <p className="welcome__loading">{summary}</p>}
          {openError && !pendingUrl && <p className="welcome__error">{openError}</p>}
        </>
      )}
    </div>
  );
}

const NO_COMMITS = "No se pudo leer el repositorio (dañado o sin commits).";
