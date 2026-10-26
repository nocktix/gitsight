import { useEffect, useState } from "react";
import { getRubricVersion, listRubricVersions } from "../api/dbClient";
import type { RubricVersion, RubricVersionFull } from "../api/dbClient";
import { useWorkspace } from "../context/useWorkspace";
import { formatSantiago } from "../utils/analysisHistory";
import { RubricCompareDialog, RubricViewDialog } from "./RubricDialogs";
import "./RubricSection.css";

/** "Versión 2 · 26-10-2026 09:00 · rubrica.pdf" (la fecha en hora de Chile). */
function versionSummary(v: RubricVersion): string {
  return [`Versión ${v.version}`, formatSantiago(v.created_at), v.filename ?? "texto pegado"].join(" · ");
}

/**
 * Rúbrica de la tarea: la versión activa destacada y, desplegable, la lista de versiones con
 * ver, activar y comparar. Una versión se aplica a TODOS los grupos de la tarea.
 */
export default function RubricSection() {
  const { active, rubricRevision, activateRubric } = useWorkspace();
  const taskId = active?.taskId;
  const [versions, setVersions] = useState<RubricVersion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [viewing, setViewing] = useState<RubricVersionFull | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [comparing, setComparing] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    listRubricVersions(taskId)
      .then((list) => !controller.signal.aborted && setVersions(list))
      .catch(() => !controller.signal.aborted && setVersions([]));
    return () => controller.abort();
  }, [taskId, rubricRevision]);

  if (!taskId || !versions || versions.length === 0) return null;
  const current = versions.find((v) => v.active) ?? null;

  async function view(version: number) {
    setError(null);
    try {
      setViewing(await getRubricVersion(taskId!, version));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la versión.");
    }
  }

  async function activate(version: number) {
    setBusy(true);
    await activateRubric(version);
    setBusy(false);
    setConfirming(null);
  }

  function togglePick(version: number) {
    setPicked((p) => (p.includes(version) ? p.filter((v) => v !== version) : [...p, version].slice(-2)));
  }

  return (
    <div className="rubric-section" data-tour="rubric">
      {current && (
        <div className="rubric-section__active">
          <span className="rubric-section__badge">Activa</span>
          <span className="rubric-section__summary">
            <strong>{versionSummary(current)}</strong>
            {current.note && <span className="rubric-section__note"> — {current.note}</span>}
          </span>
          <button onClick={() => void view(current.version)} type="button">
            Ver
          </button>
        </div>
      )}
      <button
        aria-expanded={open}
        className="rubric-section__toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? "Ocultar versiones" : `Versiones de la rúbrica (${versions.length})`}
      </button>

      {open && (
        <div className="rubric-section__list">
          <p className="rubric-section__hint">
            La versión activa se usa en los próximos análisis de todos los grupos de la tarea{" "}
            {taskId}. Los análisis ya hechos no cambian y recuerdan con qué versión se hicieron.
          </p>
          <ul className="rubric-section__versions">
            {versions.map((v) => (
              <li className="rubric-section__row" key={v.version}>
                <label className="rubric-section__pick">
                  <input
                    aria-label={`Elegir la versión ${v.version} para comparar`}
                    checked={picked.includes(v.version)}
                    onChange={() => togglePick(v.version)}
                    type="checkbox"
                  />
                </label>
                <span className="rubric-section__row-text">
                  <strong>v{v.version}</strong> · {formatSantiago(v.created_at)} ·{" "}
                  {v.filename ?? "texto pegado"}
                  {v.note && <span className="rubric-section__note"> — {v.note}</span>}
                </span>
                {v.active ? (
                  <span className="rubric-section__badge">Activa</span>
                ) : (
                  <button disabled={busy} onClick={() => setConfirming(v.version)} type="button">
                    Activar
                  </button>
                )}
                <button onClick={() => void view(v.version)} type="button">
                  Ver
                </button>
                {confirming === v.version && (
                  <p className="rubric-section__confirm" role="alert">
                    Al activar la v{v.version}, los próximos análisis de todos los grupos de la
                    tarea {taskId} la usarán. Los análisis ya hechos no cambian.{" "}
                    <button disabled={busy} onClick={() => void activate(v.version)} type="button">
                      Activar v{v.version}
                    </button>{" "}
                    <button onClick={() => setConfirming(null)} type="button">
                      Cancelar
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {versions.length > 1 && (
            <div className="rubric-section__compare">
              <button
                disabled={picked.length !== 2}
                onClick={() => {
                  const [a, b] = [...picked].sort((x, y) => x - y);
                  setComparing([a, b]);
                }}
                type="button"
              >
                Comparar versiones elegidas
              </button>
              {picked.length !== 2 && (
                <span className="rubric-section__hint">Marca dos versiones para compararlas.</span>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="rubric-section__error">{error}</p>}
      {viewing && <RubricViewDialog onClose={() => setViewing(null)} version={viewing} />}
      {comparing && (
        <RubricCompareDialog
          from={comparing[0]}
          onClose={() => setComparing(null)}
          taskId={taskId}
          to={comparing[1]}
        />
      )}
    </div>
  );
}
