import { backendFetch, errorFromResponse } from "./http.ts";

export interface ModelOption {
  id: string;
  name: string;
  free: boolean;
}

export interface ModelCatalog {
  /** Modelo principal: el primero de la cadena del modo Automático. */
  primary: string;
  models: ModelOption[];
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelCatalog> {
  const res = await backendFetch("/api/models", { signal });
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as ModelCatalog;
}
