import { useAnalysis } from "../context/useAnalysis";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import { analysisStatus } from "../utils/analysisStatus";
import { latestCommitHashes } from "../utils/analysisHistory";
import "./GroupHeader.css";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatDay(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTaskWindow(start: Date | null, end: Date | null): string | null {
  if (start && end) return `${formatDay(start)} – ${formatDay(end)}`;
  if (start) return `Inicio ${formatDay(start)}`;
  if (end) return `Entrega ${formatDay(end)}`;
  return null;
}

/** Encabezado compacto del grupo: quién es, cuánto trabajó, cómo va el análisis y el botón para analizar. */
export default function GroupHeader() {
  const { active, commits, task, taskStart, taskEnd } = useWorkspace();
  const { config } = useLlmConfig();
  const { state, runAnalysis } = useAnalysis();
  if (!active) return null;

  // Los merges se cuentan aparte (las rampas no los dibujan); los bots y el staff ya vienen excluidos del backend.
  let meta: string | null = null;
  let members: string[] = [];
  let latestHashes: Set<string> | null = null;
  if (commits.status === "success") {
    const byAuthor = commits.data.authorDailyContributionsMap;
    members = Object.keys(byAuthor);
    const all = Object.values(byAuthor).flat().flatMap((day) => day.commitResults);
    const mergeCount = all.filter((commit) => commit.isMergeCommit).length;
    const mergeLabel = mergeCount > 0 ? ` · ${mergeCount} ${mergeCount === 1 ? "merge" : "merges"}` : "";
    meta = `${all.length - mergeCount} commits${mergeLabel}`;
    latestHashes = latestCommitHashes(commits.data);
  }
  const viewing = state.status === "success" ? state.viewing : null;
  const status = analysisStatus(viewing, task.rubricVersion, latestHashes);
  const hasRubric = task.rubric !== null && task.rubric.trim() !== "";
  const busy = state.status === "loading" || state.status === "restoring";
  const window = formatTaskWindow(taskStart, taskEnd);

  return (
    <header className="group-header" data-tour="group-header">
      <div className="group-header__info">
        <h1 className="group-header__name">{active.group}</h1>
        <p className="group-header__line">
          <span>{active.taskId}</span>
          {window && <span>{window}</span>}
          {meta && <span>{meta}</span>}
          {members.length > 0 && (
            <span className="group-header__members" title={members.join(", ")}>
              {members.length} {members.length === 1 ? "integrante" : "integrantes"}: {members.join(", ")}
            </span>
          )}
        </p>
        <p className="group-header__status" role="status">
          {state.status === "loading" ? "Analizando…" : state.status === "restoring" ? "Cargando el último análisis…" : status.text}
          {!busy && status.outdatedReasons.length > 0 && (
            <span className="group-header__outdated">
              {" "}
              · Desactualizado: {status.outdatedReasons.join(" y ")}
            </span>
          )}
        </p>
      </div>
      <button
        className="group-header__analyze"
        disabled={!config || busy}
        onClick={() => runAnalysis(hasRubric ? task.rubricVersion : null)}
        title={config ? undefined : "Configura el modelo de IA para analizar"}
        type="button"
      >
        {state.status === "loading" ? "Analizando…" : viewing ? "Volver a analizar" : "Analizar"}
      </button>
    </header>
  );
}
