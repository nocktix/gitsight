import { API_BASE_URL } from "../config";
import type { CommitDiffResponse } from "../types/commitDiff";
import type { BackendErrorBody } from "../types/analyze";

export async function fetchCommitDiff(
  commitHash: string,
  repoUrl: string,
  signal?: AbortSignal,
): Promise<CommitDiffResponse> {
  const url = `${API_BASE_URL}/api/commits/${commitHash}/diff?repo_url=${encodeURIComponent(repoUrl)}`;
  const res = await fetch(url, { signal });

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

  return (await res.json()) as CommitDiffResponse;
}
