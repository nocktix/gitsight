export type MessageCheckStatus =
  | "coincide"
  | "coincide_parcialmente"
  | "no_coincide"
  | "mensaje_generico"
  | "no_evaluable";

export interface CommitSummary {
  commit_hash: string;
  repo_url: string;
  model: string;
  /** ISO 8601 UTC. */
  created_at: string;
  /** true: venía guardado, el backend no llamó al LLM. */
  cached: boolean;
  summary: string;
  main_files: { filename: string; change: string }[];
  message_check: { status: MessageCheckStatus; observation: string };
  stats: { files: number; insertions: number; deletions: number };
  /** Qué parte del diff vio el LLM; truncated = el resumen cubre solo una parte. */
  coverage: {
    truncated: boolean;
    files_total: number;
    files_complete: number;
    files_partial: number;
    files_omitted: number;
  };
}
