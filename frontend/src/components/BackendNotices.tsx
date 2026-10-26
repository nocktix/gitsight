import { useWorkspace } from "../context/useWorkspace";
import "./BackendNotices.css";

/** Pantalla de arranque mientras no se puede trabajar: leyendo del backend, o sin conexión. */
export function BackendStatusScreen() {
  const { backendStatus, backendError, retryBackend } = useWorkspace();
  return (
    <main className="backend-screen">
      {backendStatus === "error" ? (
        <>
          <p className="backend-screen__error" role="alert">
            {backendError ?? "No se pudo conectar con el backend"}
          </p>
          <button className="backend-screen__retry" onClick={retryBackend} type="button">
            Reintentar
          </button>
        </>
      ) : (
        <p>Cargando...</p>
      )}
    </main>
  );
}

/** Avisos sobre la pantalla de trabajo: importación desde localStorage y cambios sin guardar. */
export function BackendNotices() {
  const { migration, dismissMigration, writeError, dismissWriteError } = useWorkspace();
  if (!migration && !writeError) return null;
  return (
    <div className="backend-notices">
      {writeError && (
        <p className="backend-notices__item backend-notices__item--error" role="alert">
          <span>No se guardó el cambio: {writeError}</span>
          <button onClick={dismissWriteError} type="button">
            Cerrar
          </button>
        </p>
      )}
      {migration && (
        <p className="backend-notices__item" role="status">
          <span>
            Se importaron {migration.tasks} tareas, {migration.groups} grupos,{" "}
            {migration.rubrics} rúbricas y {migration.analyses} análisis desde este navegador.
            {migration.analyses_skipped_duplicate > 0 &&
              ` ${migration.analyses_skipped_duplicate} análisis ya estaban guardados.`}
            {migration.analyses_skipped_unknown_group.length > 0 &&
              ` ${migration.analyses_skipped_unknown_group.length} análisis no se importaron porque su grupo no está en ninguna tarea.`}
          </span>
          <button onClick={dismissMigration} type="button">
            Cerrar
          </button>
        </p>
      )}
    </div>
  );
}
