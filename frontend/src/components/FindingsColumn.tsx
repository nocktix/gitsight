import { useState } from "react";
import { useAnalysis } from "../context/useAnalysis";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import type { FindingType } from "../types/analyze";
import { analysisNotices, formatSantiago, historyLabel, latestCommitHashes, rubricNotice } from "../utils/analysisHistory";
import type { StoredAnalysis } from "../utils/analysisStore";
import { missingArtifacts } from "../utils/emptyStates";
import {
  FINDING_TYPES,
  TYPE_PLURAL,
  countByType,
  defaultOpenCriteria,
  emptyFilterText,
  toggleType,
  visibleFindings,
} from "../utils/findingsView";
import type { TypeCounts } from "../utils/findingsView";
import Collapsible from "./Collapsible";
import EmptyState from "./EmptyState";
import FindingCard from "./FindingCard";
import LlmErrorRetry from "./LlmErrorRetry";
import LlmNotConfigured from "./LlmNotConfigured";
import "./FindingsColumn.css";

const TYPE_SINGULAR: Record<FindingType, [string, string]> = {
  alert: ["alerta", "alertas"],
  discrepancy: ["discrepancia", "discrepancias"],
  info: ["información", "información"],
};

/** «1 alerta · 2 discrepancias»: el tipo va en texto, no solo en color. */
function CountBadges({ counts }: { counts: TypeCounts }) {
  return (
    <span className="findings__counts">
      {FINDING_TYPES.filter((t) => counts[t] > 0).map((t) => (
        <span className={`findings__count findings__count--${t}`} key={t}>
          {counts[t]} {TYPE_SINGULAR[t][counts[t] === 1 ? 0 : 1]}
        </span>
      ))}
    </span>
  );
}

/** Resultado de un análisis: filtros, criterios plegables, resumen y criterios no evaluables. */
function FindingsResult({ viewing, filter }: { viewing: StoredAnalysis; filter: ReadonlySet<FindingType> }) {
  const { criteria, general, total } = visibleFindings(viewing.data.findings, filter);
  // Lo que el evaluador abre o cierra a mano manda; el resto parte según haya alertas.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const openByDefault = defaultOpenCriteria(criteria);
  const isOpen = (name: string) => overrides[name] ?? openByDefault.has(name);
  const [generalOpen, setGeneralOpen] = useState(true);

  return (
    <>
      {total === 0 && <p className="findings__empty-filter">{emptyFilterText(filter)}</p>}
      {criteria.map(([criterion, findings], i) => (
        <Collapsible
          className="findings__criterion"
          head={
            <>
              <span className="findings__criterion-title">{criterion}</span>
              <CountBadges counts={countByType(findings)} />
            </>
          }
          id={`criterion-${i}`}
          key={criterion}
          onToggle={() => setOverrides((o) => ({ ...o, [criterion]: !isOpen(criterion) }))}
          open={isOpen(criterion)}
        >
          <div className="findings__list">
            {findings.map((finding, j) => (
              <FindingCard finding={finding} key={j} />
            ))}
          </div>
        </Collapsible>
      ))}
      {general.length > 0 && (
        <Collapsible
          className="findings__criterion"
          head={
            <>
              <span className="findings__criterion-title">Hallazgos generales</span>
              <CountBadges counts={countByType(general)} />
            </>
          }
          id="criterion-general"
          onToggle={() => setGeneralOpen((o) => !o)}
          open={generalOpen}
        >
          <div className="findings__list">
            {general.map((finding, j) => (
              <FindingCard finding={finding} key={j} />
            ))}
          </div>
        </Collapsible>
      )}
      <p className="findings__summary">{viewing.data.summary}</p>
      {viewing.data.not_assessable.length > 0 && (
        <div className="findings__not-assessable">
          <h3 className="findings__subtitle">Criterios no evaluables con estos artefactos</h3>
          <ul>
            {viewing.data.not_assessable.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * Columna de hallazgos del grupo. El análisis y su historial viven en AnalysisProvider; aquí solo
 * se presentan. Los filtros por tipo son de este grupo (App monta todo con `key` = grupo, así que
 * vuelven a «todos» al cambiar de grupo).
 */
export default function FindingsColumn() {
  const { task, commits } = useWorkspace();
  const { config } = useLlmConfig();
  const { state, setState, history, presence, rubricInfo, runAnalysis, setConfigOpen } = useAnalysis();
  const [filter, setFilter] = useState<ReadonlySet<FindingType>>(new Set());
  const hasRubric = task.rubric !== null && task.rubric.trim() !== "";
  const missing = presence ? missingArtifacts(presence) : [];
  const latestHashes = commits.status === "success" ? latestCommitHashes(commits.data) : null;

  return (
    <section className="findings" data-tour="findings">
      <h2 className="findings__title">Hallazgos</h2>
      <p className="findings__subtitle-line">Basado en commits · bitácora de prompts · autoría</p>
      {rubricInfo && state.status !== "success" && <p className="findings__info">{rubricInfo}</p>}

      {state.status === "restoring" && <p className="findings__loading">Cargando el último análisis...</p>}
      {state.status === "loading" && <p className="findings__loading">Analizando...</p>}

      {(state.status === "idle" || state.status === "error") && (
        <>
          {state.status === "error" &&
            (state.llm ? (
              <LlmErrorRetry
                className="findings__error"
                code={state.llm.code}
                failedModel={state.llm.failedModel}
                message={state.message}
                onRetry={() => runAnalysis(state.llm!.rubricVersion)}
              />
            ) : (
              <p className="findings__error">{state.message}</p>
            ))}
          {state.status === "idle" && (
            <EmptyState
              text={
                <>
                  <p>
                    Revisa la rúbrica y las fechas de la tarea y pulsa Analizar. Aquí aparecerán los
                    hechos que se encontraron, cada uno con los commits y las líneas que lo respaldan,
                    para que los verifiques con un clic.
                  </p>
                  {missing.length > 0 && (
                    <p>
                      No se encontró {missing.join(" ni ")} en este repositorio. Puedes analizar igual:
                      el informe indicará qué falta.
                    </p>
                  )}
                  {!hasRubric && (
                    <p>
                      Esta tarea no tiene rúbrica: puedes analizar igual o{" "}
                      <button className="findings__link" onClick={() => setConfigOpen(true)} type="button">
                        agregar una en la configuración de la tarea
                      </button>
                      .
                    </p>
                  )}
                </>
              }
              title="Aún no hay un análisis de este grupo"
            >
              <button
                className="findings__primary"
                disabled={!config}
                onClick={() => runAnalysis(hasRubric ? task.rubricVersion : null)}
                type="button"
              >
                Analizar
              </button>
              {!config && <LlmNotConfigured className="findings__note" />}
            </EmptyState>
          )}
          {state.status === "error" && !config && <LlmNotConfigured className="findings__note" />}
        </>
      )}

      {state.status === "success" &&
        (() => {
          const { viewing } = state;
          const counts = countByType(viewing.data.findings);
          const viewingOld = viewing.id !== history[0]?.id;
          const rubricNote = rubricNotice(viewing, task.rubricVersion);
          return (
            <>
              {history.length > 1 && (
                <div className="findings__history">
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
                <p className="findings__info">
                  Estás viendo un análisis del {formatSantiago(viewing.createdAt)} (hora de Chile){" "}
                  <button onClick={() => setState({ status: "success", viewing: history[0] })} type="button">
                    Ver el más reciente
                  </button>
                </p>
              )}
              {analysisNotices(viewing, latestHashes).map((notice) => (
                <p className="findings__info" key={notice}>
                  {notice}
                </p>
              ))}
              {rubricNote && (
                <p className="findings__info">
                  {rubricNote}{" "}
                  <button disabled={!config} onClick={() => runAnalysis(task.rubricVersion)} type="button">
                    Re-analizar con la rúbrica actual
                  </button>
                </p>
              )}
              {rubricInfo && <p className="findings__info">{rubricInfo}</p>}
              <div aria-label="Filtrar por tipo" className="findings__filters" role="group">
                {FINDING_TYPES.map((type) => (
                  <button
                    aria-pressed={filter.has(type)}
                    className={`findings__filter findings__filter--${type}`}
                    key={type}
                    onClick={() => setFilter((f) => toggleType(f, type))}
                    type="button"
                  >
                    {TYPE_PLURAL[type]} <strong>{counts[type]}</strong>
                  </button>
                ))}
              </div>
              <FindingsResult filter={filter} key={viewing.id} viewing={viewing} />
            </>
          );
        })()}
    </section>
  );
}
