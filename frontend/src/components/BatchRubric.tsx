import { useEffect, useState } from "react";
import { getRubricVersion, listRubricVersions } from "../api/dbClient";
import type { RubricVersion, RubricVersionFull } from "../api/dbClient";
import { useBatch } from "../context/useBatch";
import { useWorkspace } from "../context/useWorkspace";
import {
  LOCAL_TASK_NOTE,
  NO_RUBRIC_TEXT,
  NO_RUBRIC_WARNING,
  isLocalTask,
  rubricActions,
  rubricBlockState,
} from "../utils/batchGate";
import RubricField from "./RubricField";
import { Dialog, RubricViewDialog } from "./RubricDialogs";
import "./BatchRubric.css";

/**
 * "Rúbrica de la tarea" del lote: muestra la versión activa de la tarea escaneada y deja agregar
 * o cambiar la rúbrica ANTES de analizar. Reutiliza el editor y el visor de la vista de un grupo;
 * guardar crea una versión nueva de la tarea y no analiza nada.
 */
export default function BatchRubric() {
  const { scan, running, rubricEditorOpen, openRubricEditor, closeRubricEditor, saveBatchRubric } =
    useBatch();
  const { rubricRevision } = useWorkspace();
  const taskId = scan?.taskId;
  const [versions, setVersions] = useState<RubricVersion[] | null>(null);
  const [viewing, setViewing] = useState<RubricVersionFull | null>(null);
  const [prefill, setPrefill] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    listRubricVersions(taskId)
      .then((list) => !cancelled && (setVersions(list), setError(null)))
      .catch((err: unknown) => {
        if (cancelled) return;
        setVersions(null);
        setError(err instanceof Error ? err.message : "No se pudo leer la rúbrica de la tarea.");
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, rubricRevision]);

  if (!taskId) return null;
  const state = versions ? rubricBlockState(versions) : null;
  const actions = rubricActions(running);

  async function view(version: number) {
    setError(null);
    try {
      setViewing(await getRubricVersion(taskId!, version));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la versión.");
    }
  }

  async function change(version: number) {
    setError(null);
    try {
      // El editor parte del texto de la versión activa, como en la vista de un grupo.
      setPrefill((await getRubricVersion(taskId!, version)).content);
      openRubricEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la rúbrica.");
    }
  }

  function closeEditor() {
    setPrefill("");
    closeRubricEditor();
  }

  return (
    <section aria-label="Rúbrica de la tarea" className="batch-rubric">
      <h3 className="batch-rubric__title">Rúbrica de la tarea</h3>
      {state?.kind === "active" && (
        <div className="batch-rubric__row">
          <span className="batch-rubric__text">{state.label}</span>
          <button onClick={() => void view(state.version)} type="button">
            Ver
          </button>
          <button
            disabled={!actions.canChange}
            onClick={() => void change(state.version)}
            type="button"
          >
            Cambiar
          </button>
        </div>
      )}
      {state?.kind === "none" && (
        <div className="batch-rubric__row">
          <span className="batch-rubric__text batch-rubric__text--missing">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            {NO_RUBRIC_TEXT}
          </span>
          <button disabled={!actions.canAdd} onClick={openRubricEditor} type="button">
            Agregar rúbrica
          </button>
        </div>
      )}
      {actions.lockedText && (
        <p className="batch-rubric__hint" role="status">
          {actions.lockedText}
        </p>
      )}
      {isLocalTask(taskId) && <p className="batch-rubric__hint">{LOCAL_TASK_NOTE}</p>}
      {error && <p className="batch-rubric__error">{error}</p>}

      {viewing && <RubricViewDialog onClose={() => setViewing(null)} version={viewing} />}
      {rubricEditorOpen && (
        <Dialog
          onClose={closeEditor}
          title={state?.kind === "active" ? "Cambiar la rúbrica de la tarea" : "Agregar rúbrica a la tarea"}
        >
          <RubricField
            initialText={prefill}
            onCancel={closeEditor}
            onSaveOnly={(value) => void saveBatchRubric(value)}
            saveOnly
            submitLabel="Guardar como versión nueva"
          />
        </Dialog>
      )}
    </section>
  );
}

/** Diálogo al presionar "Analizar todos" con una tarea sin rúbrica activa. */
export function NoRubricDialog() {
  const { noRubricPrompt, closeNoRubricPrompt, addRubricFromPrompt, analyzeWithoutRubric } =
    useBatch();
  if (!noRubricPrompt) return null;
  return (
    <Dialog onClose={closeNoRubricPrompt} title="Falta la rúbrica">
      <p className="batch-rubric__dialog-text">{NO_RUBRIC_WARNING}</p>
      <div className="batch-rubric__dialog-actions">
        <button className="welcome__button" onClick={addRubricFromPrompt} type="button">
          Agregar rúbrica
        </button>
        <button className="batch__open" onClick={analyzeWithoutRubric} type="button">
          Analizar sin rúbrica
        </button>
      </div>
    </Dialog>
  );
}
