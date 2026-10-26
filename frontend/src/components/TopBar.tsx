import { useLlmConfig } from "../context/useLlmConfig";
import { useTour } from "../context/useTour";
import { useWorkspace } from "../context/useWorkspace";
import { describeConfig } from "../utils/llmConfig";
import "./TopBar.css";

function formatLoadedAt(date: Date): string {
  return date.toLocaleString("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TopBar() {
  const { active, commits, taskIds, groups, openGroup, switchTask, pendingUrl } =
    useWorkspace();
  const { store, config, openSettings } = useLlmConfig();
  const { start: startTour } = useTour();

  return (
    <header className="top-bar" data-tour="topbar">
      <span className="top-bar__title">
        <img alt="" className="top-bar__logo" height={30} src="/logo-on-dark.svg" width={30} />
        GitSight
      </span>

      {active && (
        <div className="top-bar__selectors">
          <label className="top-bar__select">
            <span className="top-bar__select-label">Tarea</span>
            <span className="top-bar__select-value">{active.taskId}</span>
            <select
              aria-label="Tarea"
              onChange={(event) => switchTask(event.target.value)}
              value={active.taskId}
            >
              {taskIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="top-bar__select">
            <span className="top-bar__select-label">Grupo</span>
            <span className="top-bar__select-value">
              {groups.find((group) => group.url === active.url)?.name ?? ""}
            </span>
            <select
              aria-label="Grupo"
              onChange={(event) => void openGroup(event.target.value)}
              value={active.url}
            >
              {groups.map((group) => (
                <option key={group.url} value={group.url}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Configurar modelo de IA"
            className={`top-bar__gear${config ? "" : " top-bar__gear--pending"}`}
            data-tour="model"
            onClick={openSettings}
            title={`Modelo de IA: ${describeConfig(store)}`}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Modelo de IA</span>
          </button>
          <button
            aria-label="Ver el recorrido guiado"
            className="top-bar__help"
            onClick={startTour}
            title="Ver el recorrido guiado"
            type="button"
          >
            ?
          </button>
        </div>
      )}

      {active && (
        <span className="top-bar__date">
          {pendingUrl
            ? "Descargando repositorio…"
            : commits.status === "success"
              ? `Datos cargados: ${formatLoadedAt(commits.loadedAt)}`
              : null}
        </span>
      )}
    </header>
  );
}
