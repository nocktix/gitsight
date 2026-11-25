import { useLlmConfig } from "../context/useLlmConfig";
import { modelStatus } from "../utils/llmConfig";
import "./ModelStatusLine.css";

/**
 * Estado del modelo de IA en la pantalla de inicio, con el botón que abre la misma ventana del
 * engranaje de la barra superior.
 */
export default function ModelStatusLine() {
  const { store, openSettings } = useLlmConfig();
  const { configured, label } = modelStatus(store);
  return (
    <p className={`model-status${configured ? "" : " model-status--pending"}`}>
      {!configured && (
        <svg aria-hidden="true" className="model-status__icon" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      )}
      <span>
        Modelo de IA: {label} ·{" "}
        <button className="model-status__button" onClick={openSettings} type="button">
          {configured ? "Cambiar" : "Configurar"}
        </button>
      </span>
    </p>
  );
}
