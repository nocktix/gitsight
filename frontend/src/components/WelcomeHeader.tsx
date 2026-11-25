import "./WelcomeHeader.css";

/** Encabezado compacto del inicio: logo pequeño, título y una línea que explica la app. */
export default function WelcomeHeader() {
  return (
    <header className="welcome-header">
      <img alt="" height={48} src="/logo.svg" width={48} />
      <div>
        <h1 className="welcome-header__title">Revisa la contribución de los grupos</h1>
        <p className="welcome-header__lead">
          Contrasta commits, bitácora y autoría con la rúbrica de la tarea.
        </p>
      </div>
    </header>
  );
}
