import { useState } from "react";
import { useBatch } from "../context/useBatch";
import { useWorkspace } from "../context/useWorkspace";
import { useOpenRepo } from "../hooks/useOpenRepo";
import TaskConfirm from "./TaskConfirm";
import "./RepoUrlField.css";

/** Abre otro grupo pegando su URL; al cargarlo queda en el historial de su tarea. */
export default function RepoUrlField() {
  const { pendingUrl, openError } = useWorkspace();
  const [value, setValue] = useState("");
  const { running, finished, analyzable, openDialog } = useBatch();
  const { toConfirm, submit, confirm, cancel } = useOpenRepo(() => setValue(""));

  return (
    <div className="repo-url-field" data-tour="repo">
      <form
        className="repo-url-field__row"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !pendingUrl) submit(value);
        }}
      >
        <label className="repo-url-field__label" htmlFor="repo-url-input">
          Abrir otro repositorio (GitHub)
        </label>
        <input
          className="repo-url-field__input"
          id="repo-url-input"
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://github.com/OWNER/REPO"
          type="text"
          value={value}
        />
        <button className="repo-url-field__button" disabled={!!pendingUrl} type="submit">
          {pendingUrl ? "Descargando…" : "Abrir"}
        </button>
        <button
          className="repo-url-field__secondary"
          onClick={openDialog}
          type="button"
        >
          Tarea completa (carpeta)
          {running && (
            <span aria-label={`${finished} de ${analyzable} grupos terminados`} className="batch__badge">
              {finished}/{analyzable}
            </span>
          )}
        </button>
      </form>
      {toConfirm && <TaskConfirm detected={toConfirm} onCancel={cancel} onConfirm={confirm} />}
      {openError && <p className="repo-url-field__error">{openError}</p>}
    </div>
  );
}
