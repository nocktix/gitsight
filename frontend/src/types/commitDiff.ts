export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  old_line_number?: number;
  new_line_number?: number;
}

export interface FileChange {
  filename: string;
  change_type: ChangeType;
  is_binary: boolean;
  lines: DiffLine[];
}

export interface CommitDiffResponse {
  hash: string;
  message_title: string;
  author: string;
  date: string;
  files: FileChange[];
}
