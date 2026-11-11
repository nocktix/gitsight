/** Dirección del backend. `VITE_API_BASE_URL` permite apuntar a otro (p. ej. con otra base de datos). */
export const API_BASE_URL =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://localhost:8000";

export const INCLUDE_PROMPT_LOG = true;
export const INCLUDE_AUTHORSHIP = true;

/**
 * Cuántos grupos se analizan a la vez en el análisis por lote. Con 1 un lote grande es lento;
 * con muchos se topa antes con el límite de pedidos por minuto de los modelos gratuitos (que
 * obliga a esperar). 3 acelera de forma notoria sin agotar ese límite de inmediato.
 */
export const BATCH_CONCURRENCY = 3;
/** Cuánto espera un grupo antes de reintentar cuando el proveedor pidió esperar (límite por minuto). */
export const BATCH_RATE_LIMIT_WAIT_MS = 30_000;
