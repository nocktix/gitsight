import { useEffect, useRef, useState } from "react";
import { fetchAnalysis } from "../api/analyzeClient";
import { BackendError } from "../api/http";
import { INCLUDE_AUTHORSHIP, INCLUDE_PROMPT_LOG } from "../config";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import type { Finding } from "../types/analyze";
import {
  analysisNotices,
  rubricNotice,
  formatSantiago,
  historyLabel,
  latestCommitHashes,
} from "../utils/analysisHistory";
import { loadAnalysisHistory } from "../utils/analysisStore";
import { llmRequest } from "../utils/llmConfig";
import type { StoredAnalysis } from "../utils/analysisStore";
import { fetchArtifact } from "../api/artifactsClient";
import { missingArtifacts } from "../utils/emptyStates";
import type { ArtifactPresence } from "../utils/emptyStates";
import EmptyState from "./EmptyState";
import FindingCard from "./FindingCard";
import LlmErrorRetry from "./LlmErrorRetry";
import LlmNotConfigured from "./LlmNotConfigured";
import RubricField from "./RubricField";
import type { RubricSubmit } from "./RubricField";
import RubricSection from "./RubricSection";
import "./TriangulationPanel.css";

type PanelState =
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

/** Criterios en el orden en que aparecen; los hallazgos generales (criterion null) van aparte. */
function groupFindings(findings: Finding[]) {
  const byCriterion = new Map<string, Finding[]>();
  const general: Finding[] = [];
  for (const finding of findings) {
    if (finding.criterion === null) {
      general.push(finding);
    } else {
      const list = byCriterion.get(finding.criterion) ?? [];
      list.push(finding);
      byCriterion.set(finding.criterion, list);
    }
  }
  return { criteria: [...byCriterion.entries()], general };
}

/**
 * El análisis con IA es manual. App lo monta con `key` = grupo activo: al cambiar de grupo se
 * cancela el análisis en curso y el panel parte con el último análisis guardado de ese grupo
 * (o vacío); lo lee del backend, que guarda un análisis nuevo cada vez que se analiza (nunca
 * reemplaza uno anterior). Con más de uno se ofrece el historial. Editar la rúbrica
 * (`editing`) es independiente del resultado mostrado.
 */
export default function TriangulationPanel() {
  const { active, task, taskStart, taskEnd, saveRubric, commits } = useWorkspace();
  const [state, setState] = useState<PanelState>({ status: "restoring" });
  /** Análisis del grupo, el más reciente primero. */
  const [history, setHistory] = useState<StoredAnalysis[]>([]);
  const [editing, setEditing] = useState(false);
  const [rubricInfo, setRubricInfo] = useState<string | null>(null);
  const { config } = useLlmConfig();
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

  if (!active) return null;
  const repoUrl = active.url;
  const taskId = active.taskId;
  const hasRubric = task.rubric !== null && task.rubric.trim() !== "";
  const deadlineMissing = !taskEnd;

  /** `rubricVersion` null: el backend usa la versión activa de la tarea (o ninguna si no hay). */
  function runAnalysis(rubricVersion: number | null) {
    if (!config) return;
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

  const missing = presence ? missingArtifacts(presence) : [];
  const latestHashes = commits.status === "success" ? latestCommitHashes(commits.data) : null;

  const deadlineNote = deadlineMissing && (
    <p className="triangulation-panel__note">
      Sin fecha de entrega, no se detectan commits posteriores a la entrega
    </p>
  );

  const rubricControls = hasRubric ? (
    <div className="triangulation-panel__rubric">
      <div className="triangulation-panel__actions">
        <button onClick={() => setEditing(true)} type="button">
          Ver o editar
        </button>
        <button
          className="triangulation-panel__primary"
          disabled={!config}
          onClick={() => runAnalysis(task.rubricVersion)}
          type="button"
        >
          Analizar
        </button>
      </div>
      {deadlineNote}
    </div>
  ) : (
    <div className="triangulation-panel__rubric">
      <p className="triangulation-panel__rubric-text">
        Para el análisis con IA puedes usar la rúbrica de la tarea, y los hallazgos se
        organizarán por criterio.
      </p>
      <div className="triangulation-panel__actions">
        <button
          className="triangulation-panel__primary"
          onClick={() => setEditing(true)}
          type="button"
        >
          Agregar rúbrica
        </button>
        <button disabled={!config} onClick={() => runAnalysis(null)} type="button">
          Analizar sin rúbrica
        </button>
      </div>
      {deadlineNote}
    </div>
  );

  return (
    <section className="triangulation-panel" data-tour="triangulation">
      <div className="triangulation-panel__header">
        <h2 className="triangulation-panel__title">Análisis de triangulación</h2>
        {state.status === "success" && (
          <span className="triangulation-panel__badge">
            {state.viewing.data.findings.length} hallazgos
          </span>
        )}
      </div>
      <p className="triangulation-panel__subtitle">
        Basado en commits · bitácora de prompts · autoría
      </p>

      {!editing && <RubricSection />}
      {!editing && rubricInfo && <p className="triangulation-panel__info">{rubricInfo}</p>}

      {editing && (
        <>
          <RubricField
            initialText={task.rubric ?? ""}
            onCancel={() => setEditing(false)}
            onSaveOnly={(value) => void saveRubricVersion(value)}
            onSubmit={async (value) => {
              const version = await saveRubricVersion(value);
              if (version !== null) runAnalysis(version);
            }}
            submitLabel="Guardar y analizar"
          />
          {deadlineNote}
        </>
      )}

      {state.status === "restoring" && (
        <p className="triangulation-panel__loading">Cargando el último análisis...</p>
      )}

      {!editing && (state.status === "idle" || state.status === "error") && (
        <>
          {state.status === "error" &&
            (state.llm ? (
              <LlmErrorRetry
                className="triangulation-panel__error"
                code={state.llm.code}
                failedModel={state.llm.failedModel}
                message={state.message}
                onRetry={() => runAnalysis(state.llm!.rubricVersion)}
              />
            ) : (
              <p className="triangulation-panel__error">{state.message}</p>
            ))}
          {!config && <LlmNotConfigured className="triangulation-panel__note" />}
          {state.status === "idle" ? (
            <EmptyState
              text={
                <>
                  <p>
                    Revisa la rúbrica y las fechas de la tarea y pulsa Analizar. Aquí aparecerán los
                    hechos que se encontraron, cada uno con los commits y las líneas que lo
                    respaldan, para que los verifiques con un clic.
                  </p>
                  {missing.length > 0 && (
                    <p>
                      No se encontró {missing.join(" ni ")} en este repositorio. Puedes analizar
                      igual: el informe indicará qué falta.
                    </p>
                  )}
                </>
              }
              title="Aún no hay un análisis de este grupo"
            >
              {rubricControls}
            </EmptyState>
          ) : (
            rubricControls
          )}
        </>
      )}

      {state.status === "loading" && (
        <p className="triangulation-panel__loading">Analizando...</p>
      )}

      {state.status === "success" &&
        (() => {
          const { viewing } = state;
          const { criteria, general } = groupFindings(viewing.data.findings);
          const viewingOld = viewing.id !== history[0]?.id;
          return (
            <>
              {history.length > 1 && (
                <div className="triangulation-panel__history">
                  <label htmlFor="analysis-history">Historial (hora de Chile)</label>
                  <select
                    id="analysis-history"
                    onChange={(e) => {
                      const picked = history.find((a) => a.id === Number(e.target.value));
                      if (picked) setState({ status: "success", viewing: picked });
                    }}
                    value={viewing.id}
                  >
                    {history.map((analysis, i) => (
                      <option key={analysis.id} value={analysis.id}>
                        {historyLabel(analysis, i === 0)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {viewingOld && (
                <p className="triangulation-panel__info">
                  Estás viendo un análisis del {formatSantiago(viewing.createdAt)} (hora de Chile){" "}
                  <button
                    onClick={() => setState({ status: "success", viewing: history[0] })}
                    type="button"
                  >
                    Ver el más reciente
                  </button>
                </p>
              )}
              {analysisNotices(viewing, latestHashes).map((notice) => (
                <p className="triangulation-panel__info" key={notice}>
                  {notice}
                </p>
              ))}
              {(() => {
                const notice = rubricNotice(viewing, task.rubricVersion);
                return (
                  notice && (
                    <p className="triangulation-panel__info">
                      {notice}{" "}
                      <button
                        disabled={!config}
                        onClick={() => runAnalysis(task.rubricVersion)}
                        type="button"
                      >
                        Re-analizar con la rúbrica actual
                      </button>
                    </p>
                  )
                );
              })()}
              {criteria.map(([criterion, findings]) => (
                <div className="triangulation-panel__group" key={criterion}>
                  <h3 className="triangulation-panel__group-title">{criterion}</h3>
                  <div className="triangulation-panel__findings">
                    {findings.map((finding, i) => (
                      <FindingCard finding={finding} key={i} />
                    ))}
                  </div>
                </div>
              ))}
              {general.length > 0 && (
                <div className="triangulation-panel__group">
                  <h3 className="triangulation-panel__group-title">Hallazgos generales</h3>
                  <div className="triangulation-panel__findings">
                    {general.map((finding, i) => (
                      <FindingCard finding={finding} key={i} />
                    ))}
                  </div>
                </div>
              )}
              <p className="triangulation-panel__summary">{viewing.data.summary}</p>
              {viewing.data.not_assessable.length > 0 && (
                <div className="triangulation-panel__group">
                  <h3 className="triangulation-panel__group-title">
                    Criterios no evaluables con estos artefactos
                  </h3>
                  <ul className="triangulation-panel__not-assessable">
                    {viewing.data.not_assessable.map((criterion) => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="triangulation-panel__actions">
                <button
                  className="triangulation-panel__primary"
                  onClick={() => runAnalysis(task.rubricVersion)}
                  type="button"
                >
                  Volver a analizar
                </button>
                <button onClick={() => setEditing(true)} type="button">
                  {hasRubric ? "Ver o editar rúbrica" : "Agregar rúbrica"}
                </button>
              </div>
              {deadlineNote}
            </>
          );
        })()}
    </section>
  );
}
