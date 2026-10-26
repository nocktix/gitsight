/** Dirección del backend. `VITE_API_BASE_URL` permite apuntar a otro (p. ej. con otra base de datos). */
export const API_BASE_URL =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ??
  "http://localhost:8000";

export const INCLUDE_PROMPT_LOG = true;
export const INCLUDE_AUTHORSHIP = true;
