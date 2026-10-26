import type { LlmSettings } from "../types/analyze";
import type { CommitSummary } from "../types/commitSummary";
import { llmHeaders } from "../utils/llmConfig.ts";
import { backendFetch, errorFromResponse } from "./http.ts";

/** Resumen ya guardado de un commit; null si todavía no hay. Nunca llama al LLM. */
export async function getSavedSummary(
  repoUrl: string,
  commitHash: string,
  signal?: AbortSignal,
): Promise<CommitSummary | null> {
  const res = await backendFetch(
    `/api/commits/${commitHash}/summary?repo_url=${encodeURIComponent(repoUrl)}`,
    { signal },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as CommitSummary;
}

/**
 * Genera el resumen con el LLM. Si ya estaba guardado el backend lo devuelve tal cual (con un
 * modelo concreto, solo si lo generó ese modelo); con `regenerate` genera uno nuevo y
 * reemplaza el guardado.
 */
export async function generateSummary(
  repoUrl: string,
  commitHash: string,
  regenerate: boolean,
  llm: LlmSettings,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CommitSummary> {
  const res = await backendFetch(`/api/commits/${commitHash}/summary`, {
    method: "POST",
    headers: llmHeaders(apiKey),
    body: JSON.stringify({ repo_url: repoUrl, regenerate, llm }),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as CommitSummary;
}
