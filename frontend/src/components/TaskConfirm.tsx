import { useState } from "react";
import { useWorkspace } from "../context/useWorkspace";
import { parseRepoUrl } from "../utils/repoUrl";
import type { ParsedRepo } from "../utils/repoUrl";
import "./TaskConfirm.css";

const NEW_TASK = "";

/**
 * Tarea sin calzar: permite elegir una tarea existente del mismo owner o crear una nueva
 * (con el identificador sugerido, editable) antes de guardar.
 */
export default function TaskConfirm({
  detected,
  onConfirm,
  onCancel,
}: {
  detected: ParsedRepo;
  onConfirm: (taskId: string) => void;
  onCancel: () => void;
}) {
  const { taskIds } = useWorkspace();
  const existing = taskIds.filter((id) => id.startsWith(`${detected.owner}/`));
  const [choice, setChoice] = useState(existing.includes(detected.taskId) ? detected.taskId : NEW_TASK);
  const [newId, setNewId] = useState(detected.taskId);
  const isNew = choice === NEW_TASK;
  const taskId = (isNew ? newId : choice).trim();
  const candidate = parseRepoUrl(detected.url, [], taskId);

  return (
    <div className="task-confirm">
      <p className="task-confirm__text">
        No se pudo asignar este repositorio a una tarea conocida. Elige a cuál pertenece o crea
        una nueva (su identificador debe ser el comienzo del nombre del repositorio; el resto es
        el grupo):
      </p>
      <select
        aria-label="Tarea"
        className="task-confirm__input"
        onChange={(event) => setChoice(event.target.value)}
        value={choice}
      >
        {existing.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
        <option value={NEW_TASK}>Nueva tarea…</option>
      </select>
      {isNew && (
        <input
          aria-label="Identificador de la tarea"
          className="task-confirm__input"
          onChange={(event) => setNewId(event.target.value)}
          type="text"
          value={newId}
        />
      )}
      {candidate ? (
        <p className="task-confirm__group">Grupo: {candidate.group}</p>
      ) : (
        <p className="task-confirm__error">
          El identificador debe tener la forma {detected.owner}/… y ser el comienzo del nombre
          del repositorio ({detected.repo}).
        </p>
      )}
      <div className="task-confirm__actions">
        <button
          className="task-confirm__primary"
          disabled={!candidate}
          onClick={() => onConfirm(taskId)}
          type="button"
        >
          Confirmar y cargar
        </button>
        <button onClick={onCancel} type="button">
          Cancelar
        </button>
      </div>
    </div>
  );
}
