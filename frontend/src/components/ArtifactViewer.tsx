import { useEffect, useRef, useState } from "react";
import { fetchArtifact } from "../api/artifactsClient";
import type { ArtifactData } from "../api/artifactsClient";
import { useEvidence } from "../context/useEvidence";
import type { ArtifactView } from "../context/useEvidence";
import { useWorkspace } from "../context/useWorkspace";
import { ARTIFACT_NAMES, lineRange } from "../utils/evidence";
import "./ArtifactViewer.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ArtifactData };

/** Archivo del repo (bitácora o autoría) con las líneas citadas resaltadas y a la vista. */
export default function ArtifactViewer({ view }: { view: ArtifactView }) {
  const { closeViewer } = useEvidence();
  const { active } = useWorkspace();
  const repoUrl = active?.url ?? "";
  const [state, setState] = useState<State>({ status: "loading" });
  const firstMarked = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchArtifact(view.kind, repoUrl, controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => controller.abort();
  }, [view.kind, repoUrl]);

  useEffect(() => {
    if (state.status === "ready") firstMarked.current?.scrollIntoView({ block: "center" });
  }, [state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeViewer();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeViewer]);

  const name = ARTIFACT_NAMES[view.kind];

  return (
    <div className="artifact-viewer__backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeViewer()}>
      <div aria-labelledby="artifact-viewer-title" aria-modal="true" className="artifact-viewer" role="dialog">
        <div className="artifact-viewer__header">
          <h2 className="artifact-viewer__title" id="artifact-viewer-title">
            {name}
            {state.status === "ready" && state.data.filename && (
              <span className="artifact-viewer__file"> · {state.data.filename}</span>
            )}
          </h2>
          <button aria-label="Cerrar" onClick={closeViewer} type="button">
            ✕
          </button>
        </div>
        <p className="artifact-viewer__cited">Líneas citadas: {lineRange(view.lineStart, view.lineEnd)}</p>

        {state.status === "loading" && <p className="artifact-viewer__status">Cargando archivo...</p>}
        {state.status === "error" && <p className="artifact-viewer__status">{state.message}</p>}

        {state.status === "ready" && !state.data.exists && (
          <p className="artifact-viewer__status">
            No se encontró un archivo parecido a {state.data.expected_filename} en este repositorio.
          </p>
        )}

        {state.status === "ready" && state.data.exists && (
          <>
            {state.data.renamed && (
              <p className="artifact-viewer__note">
                Se encontró como {state.data.filename} (nombre distinto al esperado,{" "}
                {state.data.expected_filename}).
              </p>
            )}
            <div className="artifact-viewer__lines" tabIndex={0}>
              {state.data.lines.map((text, i) => {
                const n = i + 1;
                const marked = n >= view.lineStart && n <= view.lineEnd;
                return (
                  <div
                    className={`artifact-viewer__line${marked ? " artifact-viewer__line--marked" : ""}`}
                    key={n}
                    ref={marked && n === view.lineStart ? firstMarked : undefined}
                  >
                    <span className="artifact-viewer__number">{n}</span>
                    <span className="artifact-viewer__text">{text || " "}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
