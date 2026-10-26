import { useLlmConfig } from "../context/useLlmConfig";
import "./LlmErrorRetry.css";

/** Aviso en lugar de fallar cuando todavía no hay un modelo de IA configurado. */
export default function LlmNotConfigured({ className }: { className?: string }) {
  const { openSettings } = useLlmConfig();
  return (
    <div className="llm-error">
      <p className={className} role="status">
        Para usar el análisis con IA, primero configura un modelo: elige un proveedor y pega tu
        clave (API key).
      </p>
      <div className="llm-error__retry">
        <button onClick={openSettings} type="button">
          Configurar modelo de IA
        </button>
      </div>
    </div>
  );
}
