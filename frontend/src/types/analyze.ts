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
  /** URL de GitHub (se clona o se usa la carpeta del último escaneo). */
  repo_url?: string;
  /** Carpeta local (lote). Con ella, `group_url` es la clave bajo la que se guarda el análisis. */
  repo_path?: string;
  group_url?: string;
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
  /** Idioma en que el LLM escribe los hallazgos (es, en); el backend usa es si falta. */
  language?: string;
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
  /** Idioma pedido al LLM; ausente en análisis anteriores al selector. */
  language?: string;
}

export interface BackendErrorBody {
  error: string;
  message: string;
  [key: string]: unknown;
}
