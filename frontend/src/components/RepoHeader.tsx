import { useWorkspace } from "../context/useWorkspace";
import "./RepoHeader.css";

const MONTH_ABBREV = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function formatDay(date: Date): string {
  return `${date.getDate()} ${MONTH_ABBREV[date.getMonth()]} ${date.getFullYear()}`;
}

function formatTaskWindow(start: Date | null, end: Date | null): string | null {
  if (start && end) return `Ventana de la tarea: ${formatDay(start)} – ${formatDay(end)}`;
  if (start) return `Inicio de la tarea: ${formatDay(start)}`;
  if (end) return `Entrega de la tarea: ${formatDay(end)}`;
  return null;
}

export default function RepoHeader() {
  const { active, commits, taskStart, taskEnd } = useWorkspace();
  if (!active) return null;

  // Los merges se cuentan aparte (las rampas no los dibujan); los bots y el staff ya vienen excluidos del backend.
  let meta: string | null = null;
  if (commits.status === "success") {
    const byAuthor = Object.values(commits.data.authorDailyContributionsMap);
    const all = byAuthor.flat().flatMap((day) => day.commitResults);
    const mergeCount = all.filter((commit) => commit.isMergeCommit).length;
    const commitCount = all.length - mergeCount;
    const mergeLabel =
      mergeCount > 0 ? ` · ${mergeCount} ${mergeCount === 1 ? "merge" : "merges"}` : "";
    meta = `${commitCount} commits${mergeLabel} · ${byAuthor.length} contribuidores`;
  }
  const window = formatTaskWindow(taskStart, taskEnd);

  return (
    <section className="repo-header">
      <div className="repo-header__row">
        <h1 className="repo-header__name">{active.group}</h1>
        {meta && <span className="repo-header__meta">{meta}</span>}
      </div>
      <p className="repo-header__window">
        {active.taskId}
        {window ? ` · ${window}` : ""}
      </p>
    </section>
  );
}
