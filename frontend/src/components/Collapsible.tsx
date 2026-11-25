import type { ReactNode } from "react";
import "./Collapsible.css";

interface Props {
  id: string;
  /** Contenido de la cabecera (título, conteos…): va dentro del botón. */
  head: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  /** Para el recorrido guiado. */
  dataTour?: string;
}

/** Sección plegable: la cabecera es un botón real (aria-expanded) y el contenido se abre con una animación breve. */
export default function Collapsible({ id, head, open, onToggle, children, className, dataTour }: Props) {
  return (
    <section className={`collapsible${open ? " collapsible--open" : ""}${className ? ` ${className}` : ""}`} data-tour={dataTour}>
      <button
        aria-controls={`${id}-body`}
        aria-expanded={open}
        className="collapsible__head"
        id={`${id}-head`}
        onClick={onToggle}
        type="button"
      >
        <span className="collapsible__label">{head}</span>
        <svg aria-hidden="true" className="collapsible__chevron" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div aria-labelledby={`${id}-head`} className="collapsible__body" id={`${id}-body`} role="region">
          {children}
        </div>
      )}
    </section>
  );
}
