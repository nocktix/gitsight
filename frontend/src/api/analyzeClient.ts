import type { AnalyzeRequest, AnalyzeResponse } from "../types/analyze";
import { llmHeaders } from "../utils/llmConfig.ts";
import { backendFetch, errorFromResponse } from "./http.ts";

export async function fetchAnalysis(
  request: AnalyzeRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AnalyzeResponse> {
  const res = await backendFetch("/api/analyze", {
    method: "POST",
    headers: llmHeaders(apiKey),
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as AnalyzeResponse;
}
