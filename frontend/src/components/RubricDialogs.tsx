import { useEffect, useState } from "react";
import { compareRubricVersions } from "../api/dbClient";
import type { RubricComparison, RubricVersionFull } from "../api/dbClient";
import { formatSantiago } from "../utils/analysisHistory";
import EmptyState from "./EmptyState";
import "./RubricSection.css";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function Dialog({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="rubric-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        aria-label={title}
        aria-modal="true"
        className={`rubric-dialog${wide ? " rubric-dialog--wide" : ""}`}
        role="dialog"
      >
        <div className="rubric-dialog__header">
          <h2 className="rubric-dialog__title">{title}</h2>
          <button aria-label="Cerrar" onClick={onClose} type="button">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function meta(v: RubricVersionFull): string {
  return [formatSantiago(v.created_at), v.filename ?? "texto pegado", v.note].filter(Boolean).join(" · ");
}

/** Texto de una versión de la rúbrica. */
export function RubricViewDialog({
  version,
  onClose,
}: {
  version: RubricVersionFull;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose} title={`Rúbrica, versión ${version.version}${version.active ? " (activa)" : ""}`}>
      <p className="rubric-dialog__meta">{meta(version)}</p>
      <pre className="rubric-dialog__text">{version.content}</pre>
    </Dialog>
  );
}

function Version({ v, label }: { v: RubricVersionFull; label: string }) {
  return (
    <div className="rubric-dialog__column">
      <h3 className="rubric-dialog__column-title">
        {label} · v{v.version}
      </h3>
      <p className="rubric-dialog__meta">{meta(v)}</p>
      <pre className="rubric-dialog__text">{v.content}</pre>
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const FIELD_LABEL = { id: "número", title: "título", description: "descripción" } as const;

/** Dos versiones lado a lado, con los criterios agregados, quitados y modificados. */
export function RubricCompareDialog({
  taskId,
  from,
  to,
  onClose,
}: {
  taskId: string;
  from: number;
  to: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<RubricComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    compareRubricVersions(taskId, from, to)
      .then((d) => !controller.signal.aborted && setData(d))
      .catch((err: Error) => !controller.signal.aborted && setError(err.message));
    return () => controller.abort();
  }, [taskId, from, to]);

  return (
    <Dialog onClose={onClose} title={`Comparar v${from} con v${to}`} wide>
      {!data && !error && <p className="rubric-dialog__meta">Comparando…</p>}
      {error && <p className="rubric-section__error">{error}</p>}
      {data && (
        <>
          {data.structured ? (
            <div className="rubric-diff">
              <p className="rubric-diff__summary">
                {plural(data.added.length, "agregado", "agregados")} ·{" "}
                {plural(data.removed.length, "quitado", "quitados")} ·{" "}
                {plural(data.modified.length, "modificado", "modificados")} · {data.unchanged} sin cambios
              </p>
              {data.added.length + data.removed.length + data.modified.length === 0 && (
                <EmptyState
                  text="Los criterios de las dos versiones son iguales; solo cambió el formato o el texto fuera de los criterios."
                  title="No hay diferencias en los criterios"
                />
              )}
              {data.added.map((c) => (
                <p className="rubric-diff__item rubric-diff__item--added" key={`a-${c.id}`}>
                  <strong>Agregado:</strong> {c.id} - {c.title}
                  {c.description && <span> — {c.description}</span>}
                </p>
              ))}
              {data.removed.map((c) => (
                <p className="rubric-diff__item rubric-diff__item--removed" key={`r-${c.id}`}>
                  <strong>Quitado:</strong> {c.id} - {c.title}
                  {c.description && <span> — {c.description}</span>}
                </p>
              ))}
              {data.modified.map((m) => (
                <div className="rubric-diff__item rubric-diff__item--modified" key={`m-${m.id}`}>
                  <p>
                    <strong>Modificado:</strong> {m.id} ({m.changed.map((f) => FIELD_LABEL[f]).join(", ")})
                  </p>
                  <div className="rubric-diff__pair">
                    <p>
                      <em>Antes:</em> {m.before.id} - {m.before.title}. {m.before.description}
                    </p>
                    <p>
                      <em>Ahora:</em> {m.after.id} - {m.after.title}. {m.after.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rubric-dialog__meta">
              No se reconocieron criterios numerados en una de las versiones (o en ambas), así que
              se muestran los textos completos sin marcar diferencias.
            </p>
          )}
          <div className="rubric-dialog__columns">
            <Version label="Antes" v={data.from} />
            <Version label="Después" v={data.to} />
          </div>
        </>
      )}
    </Dialog>
  );
}
