import { useStickyIfFits } from "../hooks/useStickyIfFits";
import ActivityCalendars from "./ActivityCalendars";
import FindingsColumn from "./FindingsColumn";
import GroupHeader from "./GroupHeader";
import TaskConfig from "./TaskConfig";
import "./GroupWorkspace.css";

/**
 * Pantalla de trabajo de un grupo: encabezado, configuración plegable y, debajo, los hallazgos
 * (izquierda, ~60%) junto al calendario (derecha, fijo si cabe en la ventana). Con menos de
 * 1200px se apilan: encabezado, hallazgos y calendario.
 */
export default function GroupWorkspace({ onCommitClick }: { onCommitClick: (hash: string) => void }) {
  const [sideRef, fits] = useStickyIfFits<HTMLElement>();
  return (
    <main className="group-workspace">
      <GroupHeader />
      <TaskConfig />
      <div className="group-workspace__grid">
        <FindingsColumn />
        <aside
          className={`group-workspace__side${fits ? " group-workspace__side--sticky" : ""}`}
          ref={sideRef}
        >
          <ActivityCalendars onCommitClick={onCommitClick} />
        </aside>
      </div>
    </main>
  );
}
