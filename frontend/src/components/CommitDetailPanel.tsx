import { useCallback, useEffect, useState } from "react";
import { fetchCommitDiff } from "../api/commitDiffClient";
import { useWorkspace } from "../context/useWorkspace";
import type { CommitDiffResponse } from "../types/commitDiff";
import CommitSummary from "./CommitSummary";
import DiffViewer from "./DiffViewer";
import "./CommitDetailPanel.css";

type PanelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: CommitDiffResponse };

/** Igual a --motion-base en motion.css. */
const EXIT_MS = 200;

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export default function CommitDetailPanel({
  commitHash,
  onClose,
}: {
  commitHash: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [closing, setClosing] = useState(false);
  const { active } = useWorkspace();
  const repoUrl = active?.url ?? "";

  useEffect(() => {
    // El estado parte en "loading" porque App monta el panel con key = hash del commit.
    const controller = new AbortController();

    fetchCommitDiff(commitHash, repoUrl, controller.signal)
      .then((data) => {
        setState({ status: "success", data });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState({ status: "error", message: err.message });
      });

    return () => {
      controller.abort();
    };
  }, [commitHash, repoUrl]);

  // Se cierra con la animación de salida; con prefers-reduced-motion, de inmediato.
  const close = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <div
      className={`commit-detail-overlay${closing ? " commit-detail-overlay--closing" : ""}`}
      onClick={close}
    >
      <aside
        className="commit-detail-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Cerrar"
          className="commit-detail-panel__close"
          onClick={close}
        >
          ✕
        </button>

        <div className="commit-detail-panel__scroll">
          {state.status === "loading" && (
            <p className="commit-detail-panel__loading">Cargando diff...</p>
          )}

          {state.status === "error" && (
            <p className="commit-detail-panel__error">{state.message}</p>
          )}

          {state.status === "success" && (
            <>
              <div className="commit-detail-panel__header">
                <span className="commit-detail-panel__hash">
                  {state.data.hash.slice(0, 7)}
                </span>
                <h2 className="commit-detail-panel__title">
                  {state.data.message_title}
                </h2>
                <p className="commit-detail-panel__meta">
                  {state.data.author} · {formatDate(state.data.date)}
                </p>
              </div>

              <CommitSummary key={state.data.hash} commitHash={state.data.hash} repoUrl={repoUrl} />

              <div className="commit-detail-panel__files">
                {state.data.files.map((file) => (
                  <DiffViewer file={file} key={file.filename} />
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
