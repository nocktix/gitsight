import type { ReactNode } from "react";
import "./EmptyState.css";

/** Estado vacío: qué pasa, qué hacer y (en `children`) los botones para hacerlo. */
export default function EmptyState({
  title,
  text,
  children,
}: {
  title: string;
  text: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <div className="empty-state__text">{text}</div>
      {children && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}
