import { useState } from "react";
import { useWorkspace } from "../context/useWorkspace";
import { useOpenRepo } from "../hooks/useOpenRepo";
import TaskConfirm from "./TaskConfirm";
import TopBar from "./TopBar";
import Wordmark from "./Wordmark";
import "./WelcomeScreen.css";

/** Primera ejecución (o localStorage vacío): no hay chips, fechas ni paneles, ni llamadas al backend. */
export default function WelcomeScreen() {
  const { pendingUrl, openError } = useWorkspace();
  const [value, setValue] = useState("");
  const { toConfirm, submit, confirm, cancel } = useOpenRepo(() => setValue(""));

  return (
    <div className="welcome">
      <TopBar />
      <main className="welcome__main">
        <div className="welcome__brand">
          <img alt="" height={96} src="/logo.svg" width={96} />
          <Wordmark />
        </div>
        <form
          className="welcome__card"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() && !pendingUrl) submit(value);
          }}
        >
          <h1 className="welcome__title">Revisa la contribución de un grupo</h1>
          <p className="welcome__instruction">
            Pega la URL del repositorio de GitHub de un grupo para obtener el análisis.
          </p>
          <input
            aria-label="URL del repositorio de GitHub"
            autoFocus
            className="welcome__input"
            disabled={!!pendingUrl}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://github.com/ORGANIZACION/tarea01-nombre-equipo"
            type="text"
            value={value}
          />
          {toConfirm && <TaskConfirm detected={toConfirm} onCancel={cancel} onConfirm={confirm} />}
          {openError && !pendingUrl && <p className="welcome__error">{openError}</p>}
          {pendingUrl && <p className="welcome__loading">Descargando repositorio…</p>}
          <button className="welcome__button" disabled={!!pendingUrl} type="submit">
            Cargar repositorio
          </button>
          <p className="welcome__privacy">
            El repositorio se descarga y analiza en este computador.
          </p>
        </form>
        <p className="welcome__steps">
          1. Pega la URL → 2. Revisa las fechas y la rúbrica de la tarea → 3. Genera el
          análisis
        </p>
      </main>
    </div>
  );
}
