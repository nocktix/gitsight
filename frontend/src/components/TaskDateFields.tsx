import { useWorkspace } from "../context/useWorkspace";
import "./TaskDateFields.css";

/** Fechas de la tarea activa (se guardan por tarea, no por grupo). */
export default function TaskDateFields() {
  const { task, setStartDate, setEndDate, datesError, active } = useWorkspace();

  return (
    <div className="task-date-fields" data-tour="dates">
      <div className="task-date-fields__row">
        <label className="task-date-fields__field">
          <svg aria-hidden="true" className="task-date-fields__icon" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
            <rect height="16" rx="2" width="18" x="3" y="5" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span className="task-date-fields__label">Inicio de tarea</span>
          <input
            className="task-date-fields__input"
            onChange={(event) => setStartDate(event.target.value)}
            type="date"
            value={task.startDate}
          />
        </label>
        <label className="task-date-fields__field">
          <svg aria-hidden="true" className="task-date-fields__icon" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
            <rect height="16" rx="2" width="18" x="3" y="5" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span className="task-date-fields__label">Deadline</span>
          <input
            className="task-date-fields__input"
            onChange={(event) => setEndDate(event.target.value)}
            type="date"
            value={task.endDate}
          />
        </label>
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
