export type FindingType = "info" | "discrepancy" | "alert";

/** Commit citado por un hallazgo; `hash` es el hash completo. */
export interface CommitEvidence {
  type: "commit";
  hash: string;
}

/** Líneas citadas de la bitácora de prompts o de la declaración de autoría (base 1, inclusive). */
export interface LinesEvidence {
  type: "prompt_log" | "authorship";
  line_start: number;
  line_end: number;
}

export type Evidence = CommitEvidence | LinesEvidence;

export interface Finding {
  type: FindingType;
  /** Nombre del criterio de la rúbrica, o null si el hallazgo es general. */
  criterion: string | null;
  title: string;
  description: string;
  /** Referencias ya validadas por el backend. Ausente en análisis anteriores a la evidencia. */
  evidence?: Evidence[];
  /** El hallazgo informa que un artefacto falta o tiene otro nombre: no se espera evidencia. */
  no_evidence_needed?: boolean;
}

/** Sin `model` (solo OpenRouter) el backend usa su cadena de modelos gratuitos. */
export interface LlmSettings {
  provider: string;
  model?: string;
  base_url?: string;
}

export interface AnalyzeRequest {
  repo_url: string;
  include_prompt_log: boolean;
  include_authorship: boolean;
  rubric?: string;
  /** "YYYY-MM-DD" */
  task_start?: string;
  task_deadline?: string;
  /** "owner/prefijo". Sin él, el backend no guarda el análisis. */
  task_id?: string;
  /** Versión de la rúbrica usada; si falta, el backend la busca por el texto. */
  rubric_version?: number;
  /** Proveedor y modelo elegidos (la API key viaja aparte, en el header X-LLM-Api-Key). */
  llm?: LlmSettings;
}

export interface AnalyzeResponse {
  findings: Finding[];
  not_assessable: string[];
  summary: string;
  model_used: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  sources_used: string[];
  repo_analyzed: string;
  timestamp: string;
  /** Versión de la rúbrica usada; null o ausente si no hubo (o es un análisis anterior). */
  rubric_version?: number | null;
}

export interface BackendErrorBody {
  error: string;
  message: string;
  [key: string]: unknown;
}
