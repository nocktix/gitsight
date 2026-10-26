import type { LlmConfig } from "../utils/llmConfig.ts";
import { llmHeaders, llmRequest } from "../utils/llmConfig.ts";
import { backendFetch, errorFromResponse } from "./http.ts";

export interface LlmTestResult {
  ok: true;
  /** Modelo que respondió. */
  model: string;
  latency_ms: number;
}

/** Llamada mínima con esta configuración; lanza BackendError con el error tipificado si falla. */
export async function testLlm(config: LlmConfig, signal?: AbortSignal): Promise<LlmTestResult> {
  const { llm, apiKey } = llmRequest(config);
  const res = await backendFetch("/api/llm/test", {
    method: "POST",
    headers: llmHeaders(apiKey),
    body: JSON.stringify(llm),
    signal,
  });
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as LlmTestResult;
}
