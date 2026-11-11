import { useBatch } from "../context/useBatch";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import type { BatchState } from "../utils/batchRun";
import LlmNotConfigured from "./LlmNotConfigured";
import "./BatchPanel.css";

const STATUS_TEXT: Record<BatchState["status"], string> = {
  pending: "Pendiente",
  running: "Analizando…",
  waiting: "Esperando al proveedor…",
  done: "Listo",
  error: "Error",
};

/**
 * "Tarea completa": escanea una carpeta (o un .zip) descargada con `gh teacher download` y analiza
 * cada repo. El estado vive en BatchProvider, así que este panel solo lo muestra.
 */
export default function BatchPanel() {
  const { pendingUrl, openError } = useWorkspace();
  const { config, openSettings } = useLlmConfig();
  const b = useBatch();
  const { scan, states, running } = b;

  return (
    <div className="batch">
      <p className="welcome__instruction">
        Pega la ruta de la carpeta que descargaste con <code>gh teacher download</code>, o la de un
        archivo <code>.zip</code> con esa carpeta. Cada subcarpeta (o <code>.zip</code>) es el
        repositorio de un grupo.
      </p>
      <form
        className="batch__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (b.folder.trim() && !b.scanning && !running) void b.scanFolder();
        }}
      >
        <input
          aria-label="Ruta de la carpeta o del .zip con los repositorios"
          className="welcome__input"
          disabled={b.scanning || running}
          onChange={(event) => b.setFolder(event.target.value)}
          placeholder="/Users/tu-usuario/Descargas/classroom50-tarea01 (o .zip)"
          type="text"
          value={b.folder}
        />
        <button
          className="welcome__button"
          disabled={b.scanning || running || !b.folder.trim()}
          type="submit"
        >
          {b.scanning ? "Escaneando…" : "Escanear carpeta"}
        </button>
      </form>
      {b.error && <p className="welcome__error">{b.error}</p>}

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
          {running && (
            <p className="batch__hint" role="status">
              Puedes abrir los grupos que ya están listos: el análisis de los demás sigue en
              segundo plano.
            </p>
          )}
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
              {scan.groups.map((g, i) => {
                const state = states[i] ?? { status: "pending" };
                const ready = running && state.status === "done";
                const blocked = running && state.status !== "done";
                return (
                  <tr key={g.url}>
                    <td>{g.name}</td>
                    <td>{g.commits ?? "—"}</td>
                    <td className={`batch__status batch__status--${state.status}`}>
                      {STATUS_TEXT[state.status]}
                      {state.status === "error" && <span className="batch__message">{state.message}</span>}
                    </td>
                    <td>
                      <button
                        className={`batch__open${ready ? " batch__open--ready" : ""}`}
                        disabled={!g.hasOrigin || blocked || !!pendingUrl}
                        onClick={() => void b.openGroup(g)}
                        title={
                          !g.hasOrigin
                            ? "Sin origin de GitHub: solo se puede analizar en lote."
                            : blocked
                              ? "Disponible cuando el análisis de este grupo esté listo."
                              : undefined
                        }
                        type="button"
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!config && <LlmNotConfigured className="welcome__error" />}
          {b.stopped && (
            <div className="batch__stopped" role="alert">
              <p>
                <strong>El análisis por lote se detuvo.</strong> {b.stopped.message}
              </p>
              <p>Lo que ya se analizó quedó guardado; los demás grupos siguen pendientes.</p>
              {!b.stopped.backendDown && (
                <button className="batch__open" onClick={openSettings} type="button">
                  Configurar IA
                </button>
              )}
            </div>
          )}
          {running && (
            <progress aria-label="Progreso del análisis" max={b.analyzable} value={b.finished} />
          )}
          <div className="batch__actions">
            <button
              className="welcome__button"
              disabled={!config || running || b.remaining === 0}
              onClick={() => void b.analyzeAll()}
              type="button"
            >
              {running
                ? "Analizando…"
                : b.canContinue
                  ? `Continuar con ${b.remaining} pendientes`
                  : "Analizar todos"}
            </button>
            {running && (
              <button className="batch__cancel" onClick={b.cancel} type="button">
                Cancelar
              </button>
            )}
            {running && (
              <span className="batch__count">
                {b.finished} de {b.analyzable}
              </span>
            )}
          </div>
          {b.summary && <p className="welcome__loading">{b.summary}</p>}
          {openError && !pendingUrl && <p className="welcome__error">{openError}</p>}
        </>
      )}
    </div>
  );
}
