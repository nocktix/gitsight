export interface FileTypeContribution {
  insertions: number;
  deletions: number;
}

export interface CommitResult {
  hash: string;
  isMergeCommit: boolean;
  /** Fecha y hora en hora de Chile (America/Santiago), ISO 8601 con offset. */
  authoredAt: string;
  messageTitle: string;
  messageBody: string;
  fileTypesAndContributionMap: Record<string, FileTypeContribution>;
}

export interface DailyContribution {
  date: string;
  commitResults: CommitResult[];
}

export interface CommitsData {
  authorDailyContributionsMap: Record<string, DailyContribution[]>;
  authorFileTypeContributionMap: Record<string, unknown>;
  authorContributionVariance: Record<string, unknown>;
  authorDisplayNameMap: Record<string, string>;
}

/** Un commit ya aplanado y listo para graficar (sin merges). Día y hora son los de Chile. */
export interface CommitPoint {
  hash: string;
  messageTitle: string;
  /** "YYYY-MM-DD" */
  dayKey: string;
  /** Minutos desde las 00:00 (0–1439). */
  minutesOfDay: number;
  insertions: number;
  deletions: number;
  totalLines: number;
}

export interface Contributor {
  author: string;
  commits: CommitPoint[];
}
