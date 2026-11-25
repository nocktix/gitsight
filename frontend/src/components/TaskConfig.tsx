import { useState } from "react";
import { useAnalysis } from "../context/useAnalysis";
import { useLlmConfig } from "../context/useLlmConfig";
import { useWorkspace } from "../context/useWorkspace";
import { taskConfigSummary } from "../utils/taskConfigSummary";
import Collapsible from "./Collapsible";
import RubricField from "./RubricField";
import RubricSection from "./RubricSection";
import TaskDateFields from "./TaskDateFields";
import "./TaskConfig.css";

/**
 * Configuración de la tarea (fechas y rúbrica con sus versiones), plegable. Cerrada por defecto si
 * ya hay fecha de entrega y rúbrica; abierta, diciendo qué falta, si no. Lo que el evaluador abre o
 * cierra a mano manda sobre eso.
 */
export default function TaskConfig() {
  const { task, taskEnd } = useWorkspace();
  const { config } = useLlmConfig();
  const { editing, setEditing, configOpen, setConfigOpen, runAnalysis, saveRubricVersion } = useAnalysis();
  const { summary, missing } = taskConfigSummary(task);
  // Se decide al abrir el grupo: si se recalculara, la sección se plegaría sola al completar la
  // última fecha o la rúbrica que faltaba, mientras el evaluador todavía la está usando.
  const [openByDefault] = useState(missing.length > 0);
  const open = configOpen ?? openByDefault;
  const hasRubric = task.rubric !== null && task.rubric.trim() !== "";

  return (
    <Collapsible
      className="task-config"
      dataTour="config"
      head={
        <>
          <span className="task-config__title">Configuración de la tarea</span>
          <span className={`task-config__summary${missing.length > 0 ? " task-config__summary--missing" : ""}`}>
            {summary}
            {!open && " · Editar"}
          </span>
        </>
      }
      id="task-config"
      onToggle={() => setConfigOpen(!open)}
      open={open}
    >
      <TaskDateFields />
      {!taskEnd && (
        <p className="task-config__note">Sin fecha de entrega, no se detectan commits posteriores a la entrega</p>
      )}
      {editing ? (
        <RubricField
          initialText={task.rubric ?? ""}
          onCancel={() => setEditing(false)}
          onSaveOnly={(value) => void saveRubricVersion(value)}
          onSubmit={async (value) => {
            const version = await saveRubricVersion(value);
            if (version !== null) runAnalysis(version);
          }}
          submitLabel="Guardar y analizar"
        />
      ) : (
        <>
          <RubricSection />
          {!hasRubric && (
            <p className="task-config__note">
              Con la rúbrica de la tarea, los hallazgos se organizan por criterio.
            </p>
          )}
          <div className="task-config__actions">
            <button
              className={hasRubric ? undefined : "task-config__primary"}
              onClick={() => setEditing(true)}
              type="button"
            >
              {hasRubric ? "Ver o editar rúbrica" : "Agregar rúbrica"}
            </button>
            {!hasRubric && (
              <span className="task-config__hint">
                {config ? "También puedes analizar sin rúbrica." : "Configura el modelo para analizar."}
              </span>
            )}
          </div>
        </>
      )}
    </Collapsible>
  );
}
