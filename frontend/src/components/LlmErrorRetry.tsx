import { useLlmConfig } from "../context/useLlmConfig";
import { friendlyLlmError, isRetryable } from "../utils/llmErrors";
import "./LlmErrorRetry.css";

/**
 * Error del LLM en lenguaje simple, con "Reintentar" (solo si puede ser pasajero) y
 * "Cambiar modelo o proveedor", que abre la configuración.
 */
export default function LlmErrorRetry({
  code,
  message,
  failedModel,
  onRetry,
  className,
}: {
  code: string | null;
  /** Mensaje del backend; solo se usa si el código no tiene texto propio. */
  message: string;
  failedModel: string | null;
  onRetry: () => void;
  className?: string;
}) {
  const { openSettings } = useLlmConfig();

  return (
    <div className="llm-error">
      <p className={className} role="alert">
        {friendlyLlmError(code, failedModel, message)}
      </p>
      <div className="llm-error__retry">
        {isRetryable(code) && (
          <button onClick={onRetry} type="button">
            Reintentar
          </button>
        )}
        <button onClick={openSettings} type="button">
          Cambiar modelo o proveedor
        </button>
      </div>
    </div>
  );
}
