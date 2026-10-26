import { API_BASE_URL } from "../config";
import type { BackendErrorBody } from "../types/analyze";

/** Sube el archivo de la rúbrica y devuelve el texto extraído (no se guarda en el backend). */
export async function extractRubric(file: File, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/rubric/extract`, {
    method: "POST",
    body: form,
    signal,
  });

  if (!res.ok) {
    let message = `Error del servidor (${res.status}).`;
    try {
      const body = (await res.json()) as BackendErrorBody;
      if (body.message) message = body.message;
    } catch {
      // el body no era JSON parseable, nos quedamos con el mensaje genérico
    }
    throw new Error(message);
  }

  return ((await res.json()) as { text: string }).text;
}
