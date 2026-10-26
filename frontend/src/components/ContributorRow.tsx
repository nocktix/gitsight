import type { ReactNode } from "react";
import "./ContributorRow.css";

/** Fila de un contribuidor: bloque fijo con nombre y totales a la izquierda, contenido a la derecha. */
export default function ContributorRow({
  author,
  children,
  dimmed = false,
  group = false,
  stats,
}: {
  author: string;
  children: ReactNode;
  /** Nombre en color secundario (fila no destacada). */
  dimmed?: boolean;
  /** Fila resumen del grupo: nombre en negrita y línea separadora debajo. */
  group?: boolean;
  stats: string;
}) {
  return (
    <div className={group ? "contributor-row contributor-row--group" : "contributor-row"}>
      <div className="contributor-row__info">
        <span
          className={
            dimmed
              ? "contributor-row__name contributor-row__name--dimmed"
              : "contributor-row__name"
          }
        >
          {author}
        </span>
        <span className="contributor-row__stats">{stats}</span>
      </div>
      <div className="contributor-row__content">{children}</div>
    </div>
  );
}
