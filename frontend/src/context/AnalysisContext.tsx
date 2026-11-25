import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchAnalysis } from "../api/analyzeClient";
import { fetchArtifact } from "../api/artifactsClient";
import { BackendError } from "../api/http";
import type { RubricSubmit } from "../components/RubricField";
import { INCLUDE_AUTHORSHIP, INCLUDE_PROMPT_LOG } from "../config";
import { loadAnalysisHistory } from "../utils/analysisStore";
import type { StoredAnalysis } from "../utils/analysisStore";
import type { ArtifactPresence } from "../utils/emptyStates";
import { llmRequest } from "../utils/llmConfig";
import { AnalysisContext } from "./useAnalysis";
import type { PanelState } from "./useAnalysis";
import { useLlmConfig } from "./useLlmConfig";
import { useWorkspace } from "./useWorkspace";

/**
 * El análisis con IA es manual. App lo monta con `key` = grupo activo: al cambiar de grupo se
 * cancela el análisis en curso y se parte con el último análisis guardado de ese grupo (o vacío);
 * lo lee del backend, que guarda un análisis nuevo cada vez que se analiza (nunca reemplaza uno
 * anterior). Con más de uno se ofrece el historial. Editar la rúbrica (`editing`) es
 * independiente del resultado mostrado.
 *
 * Este estado vivía en TriangulationPanel; está aquí para que lo compartan el encabezado, la
 * configuración de la tarea y los hallazgos.
 */
export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { active, task, taskStart, taskEnd, saveRubric } = useWorkspace();
  const [state, setState] = useState<PanelState>({ status: "restoring" });
  /** Análisis del grupo, el más reciente primero. */
  const [history, setHistory] = useState<StoredAnalysis[]>([]);
  const [editing, setEditing] = useState(false);
  const [rubricInfo, setRubricInfo] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState<boolean | null>(null);
  const { config, language } = useLlmConfig();
  const controllerRef = useRef<AbortController | null>(null);
  const activeUrl = active?.url;
  /** Qué archivos del repo existen (bitácora y autoría); null mientras se consulta. */
  const [presence, setPresence] = useState<ArtifactPresence[] | null>(null);

  useEffect(() => {
    if (!activeUrl) return;
    const controller = new AbortController();
    Promise.all([
      fetchArtifact("prompt_log", activeUrl, controller.signal),
      fetchArtifact("authorship", activeUrl, controller.signal),
    ])
      .then(([log, authorship]) =>
        setPresence([
          { expected: log.expected_filename, label: "la bitácora de prompts", found: log.exists },
          { expected: authorship.expected_filename, label: "la declaración de autoría", found: authorship.exists },
        ]),
      )
      .catch(() => {
        // sin esta consulta el aviso simplemente no se muestra: el análisis informa lo que falte
      });
    return () => controller.abort();
  }, [activeUrl]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  useEffect(() => {
    if (!activeUrl) return;
    let cancelled = false;
    // Si el evaluador ya lanzó un análisis mientras tanto, ese resultado manda.
    const apply = (next: PanelState) =>
      setState((prev) => (!cancelled && prev.status === "restoring" ? next : prev));
    loadAnalysisHistory(activeUrl)
      .then((saved) => {
        if (cancelled) return;
        setHistory(saved);
        apply(saved.length > 0 ? { status: "success", viewing: saved[0] } : { status: "idle" });
      })
      .catch((err: unknown) =>
        apply({
          status: "error",
          message: err instanceof Error ? err.message : "No se pudo conectar con el backend",
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [activeUrl]);

  const repoUrl = active?.url;
  const taskId = active?.taskId;

  /** `rubricVersion` null: el backend usa la versión activa de la tarea (o ninguna si no hay). */
  function runAnalysis(rubricVersion: number | null) {
    if (!config || !repoUrl || !taskId) return;
    setRubricInfo(null);
    const { llm, apiKey } = llmRequest(config);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });

    fetchAnalysis(
      {
        repo_url: repoUrl,
        include_prompt_log: INCLUDE_PROMPT_LOG,
        include_authorship: INCLUDE_AUTHORSHIP,
        task_id: taskId,
        llm,
        language,
        ...(rubricVersion !== null ? { rubric_version: rubricVersion } : {}),
        ...(taskStart ? { task_start: task.startDate } : {}),
        ...(taskEnd ? { task_deadline: task.endDate } : {}),
      },
      apiKey,
      controller.signal,
    )
      .then(async (data) => {
        // El backend ya guardó el análisis nuevo: se relee el historial para tener su fila.
        const saved = await loadAnalysisHistory(repoUrl).catch(() => null);
        if (controller.signal.aborted) return;
        let viewing = saved?.find((a) => a.createdAt === data.timestamp);
        if (!viewing) {
          // No se pudo leer la fila: el resultado se muestra igual, solo en pantalla.
          viewing = {
            id: -1,
            data,
            model: data.model_used,
            rubricVersion: data.rubric_version ?? null,
            rubricState:
              data.rubric_version != null
                ? "version"
                : data.sources_used.includes("rubric")
                  ? "unknown"
                  : "none",
            headCommit: null,
            createdAt: data.timestamp,
          };
          setHistory([viewing, ...(saved ?? [])]);
        } else {
          setHistory(saved ?? []);
        }
        setState({ status: "success", viewing });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({
          status: "error",
          message: err.message,
          ...(err instanceof BackendError && err.isLlmError
            ? { llm: { code: err.code, failedModel: err.modelAttempted, rubricVersion } }
            : {}),
        });
      });
  }

  /** Aviso tras guardar una versión de la rúbrica sin analizar. */
  const saveRubricVersion = async ({ text, filename, note }: RubricSubmit) => {
    // Si no se guarda (el error se avisa aparte), el editor queda abierto con el texto.
    const saved = await saveRubric(text, { filename, note });
    if (saved === null) return null;
    setEditing(false);
    setRubricInfo(
      saved.created
        ? `Se guardó la versión v${saved.version} y quedó activa para los próximos análisis de todos los grupos de la tarea.`
        : `El texto es igual al de la versión v${saved.version}: no se creó una versión nueva y v${saved.version} quedó activa.`,
    );
    return saved.version;
  };

  return (
    <AnalysisContext.Provider
      value={{
        state,
        setState,
        history,
        editing,
        setEditing,
        rubricInfo,
        configOpen,
        setConfigOpen,
        presence,
        runAnalysis,
        saveRubricVersion,
      }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}
