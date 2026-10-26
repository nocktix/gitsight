/** Errores del LLM en lenguaje simple (la audiencia son profesores, no desarrolladores). */

export const LLM_ERROR_CODES = [
  "llm_not_configured",
  "invalid_api_key",
  "no_credit_or_rate_limit",
  "model_not_found",
  "provider_unreachable",
  "timeout",
  "provider_error",
  "llm_invalid_response_format",
] as const;

/** Errores que se arreglan cambiando la configuración, no reintentando. */
const NEEDS_SETTINGS = new Set(["llm_not_configured", "invalid_api_key", "no_credit_or_rate_limit", "model_not_found"]);

export function isLlmErrorCode(code: string | null): boolean {
  return code !== null && (LLM_ERROR_CODES as readonly string[]).includes(code);
}

/** ¿Tiene sentido reintentar tal cual? (falla pasajera del proveedor o del modelo) */
export function isRetryable(code: string | null): boolean {
  return code !== null && !NEEDS_SETTINGS.has(code);
}

export function friendlyLlmError(code: string | null, model: string | null, fallback: string): string {
  const which = model ? ` (${model})` : "";
  switch (code) {
    case "llm_not_configured":
      return "Todavía no hay un modelo de IA configurado. Elige un proveedor, un modelo y tu clave (API key).";
    case "invalid_api_key":
      return "La clave (API key) no es válida o no tiene permiso. Revísala o crea una nueva en la página de tu proveedor.";
    case "no_credit_or_rate_limit":
      return "Tu proveedor indica que no queda crédito o que se alcanzó el límite de uso. Espera un momento, recarga saldo o prueba con otro modelo o proveedor.";
    case "model_not_found":
      return `El proveedor no reconoce el modelo${which}. Revisa que el nombre esté bien escrito o elige otro.`;
    case "provider_unreachable":
      return "No se pudo conectar con el proveedor. Revisa tu conexión a internet o la dirección configurada (si usas Ollama, que esté encendido).";
    case "timeout":
      return "El proveedor tardó demasiado en responder. Intenta de nuevo o prueba con otro modelo.";
    case "provider_error":
      return `El proveedor tuvo un problema al responder${which}. Intenta de nuevo en unos minutos o prueba con otro modelo.`;
    case "llm_invalid_response_format":
      return `El modelo${which} no respondió en el formato esperado, ni siquiera tras un reintento. Prueba con otro modelo.`;
    default:
      return fallback;
  }
}
