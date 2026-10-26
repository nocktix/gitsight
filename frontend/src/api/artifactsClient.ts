import type { ArtifactKind } from "../utils/evidence.ts";
import { backendFetch, errorFromResponse } from "./http.ts";

export interface ArtifactData {
  kind: ArtifactKind;
  exists: boolean;
  expected_filename: string;
  /** Nombre real con que se encontró en el repo; null si no existe. */
  filename: string | null;
  /** Se encontró con un nombre distinto al esperado. */
  renamed: boolean;
  other_candidates: string[];
  /** Una entrada por línea; la primera es la línea 1 (la misma numeración de la evidencia). */
  lines: string[];
}

export async function fetchArtifact(
  kind: ArtifactKind,
  repoUrl: string,
  signal?: AbortSignal,
): Promise<ArtifactData> {
  const res = await backendFetch(
    `/api/artifacts/${kind}?repo_url=${encodeURIComponent(repoUrl)}`,
    { signal },
  );
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as ArtifactData;
}
