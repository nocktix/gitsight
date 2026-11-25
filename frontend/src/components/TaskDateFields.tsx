import { useState } from "react";
import { useWorkspace } from "../context/useWorkspace";
import { decideDateCommit } from "../utils/taskDates";
import "./TaskDateFields.css";

const CALENDAR_ICON = (
  <svg aria-hidden="true" className="task-date-fields__icon" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
    <rect height="16" rx="2" width="18" x="3" y="5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

/**
 * Un campo de fecha. Lo que se escribe es un borrador: solo se guarda una fecha completa (año de
 * 4 dígitos), no los valores intermedios que entrega el campo mientras se teclea el año. Lo guardado
 * (`saved`) es la única fuente de verdad: si cambia por fuera (un guardado fallido, una relectura),
 * el campo lo sigue.
 */
function DateField({ label, saved, onSave }: { label: string; saved: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setDraft(saved);
  }

  return (
    <label className="task-date-fields__field">
      {CALENDAR_ICON}
      <span className="task-date-fields__label">{label}</span>
      <input
        className="task-date-fields__input"
        onBlur={() => {
          const action = decideDateCommit(draft, saved, "blur");
          if (action === "save") onSave(draft);
          else if (action === "revert") setDraft(saved);
        }}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          if (decideDateCommit(value, saved, "change") === "save") onSave(value);
        }}
        type="date"
        value={draft}
      />
    </label>
  );
}

/** Fechas de la tarea activa (se guardan por tarea, no por grupo). */
export default function TaskDateFields() {
  const { task, setStartDate, setEndDate, datesError, active } = useWorkspace();

  return (
    <div className="task-date-fields" data-tour="dates">
      <div className="task-date-fields__row">
        <DateField label="Inicio de tarea" onSave={setStartDate} saved={task.startDate} />
        <DateField label="Deadline" onSave={setEndDate} saved={task.endDate} />
        {active && (
          <span className="task-date-fields__hint">
            Fechas de {active.taskId} · hora de Chile
          </span>
        )}
      </div>
      {datesError && <p className="task-date-fields__error">{datesError}</p>}
    </div>
  );
}
