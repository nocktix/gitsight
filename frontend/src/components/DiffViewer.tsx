import type { ChangeType, FileChange } from "../types/commitDiff";
import "./DiffViewer.css";

const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
};

export default function DiffViewer({ file }: { file: FileChange }) {
  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header">
        <span className="diff-viewer__filename">{file.filename}</span>
        <span className={`diff-viewer__badge diff-viewer__badge--${file.change_type}`}>
          {CHANGE_TYPE_LABEL[file.change_type]}
        </span>
      </div>

      {file.is_binary ? (
        <p className="diff-viewer__binary">
          Archivo binario, no se puede mostrar el diff
        </p>
      ) : (
        <div className="diff-viewer__lines">
          {file.lines.map((line, i) => (
            <div className={`diff-viewer__line diff-viewer__line--${line.type}`} key={i}>
              <span className="diff-viewer__line-number">
                {line.old_line_number ?? ""}
              </span>
              <span className="diff-viewer__line-number">
                {line.new_line_number ?? ""}
              </span>
              <span className="diff-viewer__line-marker">
                {line.type === "added" ? "+" : line.type === "removed" ? "−" : ""}
              </span>
              <span className="diff-viewer__line-content">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
