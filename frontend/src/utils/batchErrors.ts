import { BackendError, BackendUnreachableError } from "../api/http.ts";
import type { BatchErrorKind } from "./batchRun.ts";

/** Errores que no se arreglan reintentando: hay que cambiar la configuración o encender el backend. */
const STOPPING_CODES = new Set([
  "no_credit_or_rate_limit",
  "invalid_api_key",
  "model_not_found",
  "llm_not_configured",
  "provider_unreachable", // sin conexión con el proveedor: afecta a todos los grupos
]);

/**
 * Qué hace el lote ante un error de un grupo: `rate_limited` espera y reintenta; `stop` detiene el
 * lote (sin crédito, clave inválida, modelo inexistente, IA sin configurar, proveedor o backend
 * inalcanzables; un `timeout` sí es de un solo grupo);
 * cualquier otro error solo marca a ese grupo.
 */
export function classifyBatchError(err: unknown): BatchErrorKind {
  if (err instanceof BackendUnreachableError) return "stop";
  if (err instanceof BackendError) {
    if (err.code === "rate_limited") return "rate_limited";
    if (err.code && STOPPING_CODES.has(err.code)) return "stop";
  }
  return "error";
}
