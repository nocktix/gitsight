import { API_BASE_URL } from "../config.ts";
import type { BackendErrorBody } from "../types/analyze";
import { isLlmErrorCode } from "../utils/llmErrors.ts";

export const BACKEND_UNREACHABLE = "No se pudo conectar con el backend";

/** El backend no respondió (apagado, puerto equivocado, red caída). */
export class BackendUnreachableError extends Error {
  constructor() {
    super(BACKEND_UNREACHABLE);
    this.name = "BackendUnreachableError";
  }
}

/** `fetch` contra el backend: un fallo de red se convierte en `BackendUnreachableError`. */
export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new BackendUnreachableError();
  }
}

/** Error de una respuesta HTTP del backend; `code` es el campo `error` del body, si lo trae. */
export class BackendError extends Error {
  code: string | null;
  /** Modelo que falló, cuando el error viene del LLM. */
  modelAttempted: string | null;

  constructor(message: string, code: string | null = null, modelAttempted: string | null = null) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.modelAttempted = modelAttempted;
  }

  /** El LLM no pudo responder (key, crédito, modelo, red o respuesta sin el formato pedido). */
  get isLlmError(): boolean {
    return isLlmErrorCode(this.code);
  }
}

/** Mensaje de un error HTTP: `message` (errores propios) o `detail` (los de FastAPI). */
export async function errorFromResponse(res: Response): Promise<BackendError> {
  let message = `Error del servidor (${res.status}).`;
  let code: string | null = null;
  let modelAttempted: string | null = null;
  try {
    const body = (await res.json()) as Partial<BackendErrorBody> & { detail?: unknown };
    if (typeof body.message === "string") message = body.message;
    else if (typeof body.detail === "string") message = body.detail;
    if (typeof body.error === "string") code = body.error;
    if (typeof body.model_attempted === "string") modelAttempted = body.model_attempted;
  } catch {
    // el body no era JSON parseable, nos quedamos con el mensaje genérico
  }
  return new BackendError(message, code, modelAttempted);
}
