import type { ReactNode } from "react";
import "./WelcomeCard.css";

interface Props {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Tarjeta que se abre: cerrada solo muestra ícono, título y subtítulo; abierta (aria-expanded)
 * despliega su contenido. La cabecera es un botón real, así que sirve con Enter y Espacio.
 */
export default function WelcomeCard({ id, icon, title, subtitle, open, onToggle, children }: Props) {
  return (
    <section className={`welcome-card${open ? " welcome-card--open" : ""}`}>
      <button
        aria-controls={`${id}-body`}
        aria-expanded={open}
        className="welcome-card__head"
        id={`${id}-head`}
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className="welcome-card__icon">
          {icon}
        </span>
        <span className="welcome-card__text">
          <span className="welcome-card__title">{title}</span>
          <span className="welcome-card__subtitle">{subtitle}</span>
        </span>
        <svg aria-hidden="true" className="welcome-card__chevron" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div aria-labelledby={`${id}-head`} className="welcome-card__body" id={`${id}-body`} role="region">
          {children}
        </div>
      )}
    </section>
  );
}
