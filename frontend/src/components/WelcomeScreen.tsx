import { useMemo, useState } from "react";
import { useWorkspace } from "../context/useWorkspace";
import { useOpenRepo } from "../hooks/useOpenRepo";
import { DEMO_REPO_URL, mergeRecents } from "../utils/recentGroups";
import type { RecentGroup } from "../utils/recentGroups";
import { checkRepoUrl, visibleCheck } from "../utils/repoUrlCheck";
import { readRecent } from "../utils/storage";
import { BatchResults, BatchScanForm } from "./BatchPanel";
import QuickAccess from "./QuickAccess";
import TaskConfirm from "./TaskConfirm";
import TopBar from "./TopBar";
import WelcomeCard from "./WelcomeCard";
import WelcomeHeader from "./WelcomeHeader";
import WelcomeSteps from "./WelcomeSteps";
import "./WelcomeScreen.css";

type CardId = "group" | "batch";

const ICON_PROPS = {
  "aria-hidden": true,
  fill: "none",
  height: 26,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
  viewBox: "0 0 24 24",
  width: 26,
} as const;

const GROUP_ICON = (
  <svg {...ICON_PROPS}>
    <circle cx="6" cy="5" r="2.5" />
    <circle cx="6" cy="19" r="2.5" />
    <circle cx="18" cy="9" r="2.5" />
    <path d="M6 7.5v9M18 11.5c0 4-12 2-12 5" />
  </svg>
);

const BATCH_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M8 13h8" />
  </svg>
);

/**
 * Pantalla de inicio: primera ejecución, o cuando se vuelve desde el logo de la barra superior
 * (en ese caso no se borra nada: los accesos rápidos devuelven al grupo anterior).
 */
export default function WelcomeScreen() {
  const { active, showHome, leaveHome, pendingUrl, openError, openGroup, detectTask, savedGroups } = useWorkspace();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState<CardId | null>("group");
  const { toConfirm, submit, confirm, cancel } = useOpenRepo(() => setValue(""));

  const check = checkRepoUrl(value, value.trim() ? detectTask(value) : null);
  const shown = visibleCheck(check, touched);
  const recent = useMemo(() => mergeRecents(readRecent(), savedGroups), [savedGroups]);

  function toggle(card: CardId) {
    setOpen((current) => (current === card ? null : card));
  }

  function openRecent(group: RecentGroup) {
    void openGroup(group.groupUrl, group.taskId);
  }

  function tryDemo() {
    setOpen("group");
    setValue(DEMO_REPO_URL);
    setTouched(false);
    submit(DEMO_REPO_URL);
  }

  return (
    <div className="welcome">
      <TopBar />
      <main className="welcome__main">
        {active && showHome && (
          <button className="welcome__back" onClick={leaveHome} type="button">
            ← Volver a {active.group}
          </button>
        )}
        <WelcomeHeader />
        <WelcomeSteps />
        <div className="welcome__cards">
          <WelcomeCard
            icon={GROUP_ICON}
            id="welcome-group"
            onToggle={() => toggle("group")}
            open={open === "group"}
            subtitle="Desde la URL de GitHub"
            title="Un grupo"
          >
            <form
              className="welcome__form"
              onSubmit={(event) => {
                event.preventDefault();
                setTouched(true);
                if (check.kind === "valid" && !pendingUrl) submit(value);
              }}
            >
              <p className="welcome__instruction">Pega la URL del repositorio de un grupo</p>
              <input
                aria-describedby="welcome-url-check"
                aria-invalid={shown?.kind === "invalid" || undefined}
                aria-label="URL del repositorio de GitHub"
                autoFocus
                className="welcome__input"
                disabled={!!pendingUrl}
                onBlur={() => setTouched(true)}
                onChange={(event) => {
                  setValue(event.target.value);
                  setTouched(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setTouched(true);
                }}
                placeholder="https://github.com/ORGANIZACION/tarea01-nombre-equipo"
                type="text"
                value={value}
              />
              <p
                aria-live="polite"
                className={`welcome__check${shown ? ` welcome__check--${shown.kind}` : ""}`}
                id="welcome-url-check"
              >
                {shown && shown.kind !== "empty" ? shown.text : null}
              </p>
              {toConfirm && <TaskConfirm detected={toConfirm} onCancel={cancel} onConfirm={confirm} />}
              {openError && !pendingUrl && <p className="welcome__error">{openError}</p>}
              {pendingUrl && <p className="welcome__loading">Descargando repositorio…</p>}
              <button
                className="welcome__button"
                disabled={!!pendingUrl || check.kind !== "valid"}
                type="submit"
              >
                Cargar repositorio
              </button>
              <p className="welcome__privacy">
                El repositorio se descarga y analiza en este computador.
              </p>
            </form>
          </WelcomeCard>
          <WelcomeCard
            icon={BATCH_ICON}
            id="welcome-batch"
            onToggle={() => toggle("batch")}
            open={open === "batch"}
            subtitle="Todos los grupos de una vez"
            title="Tarea completa"
          >
            <p className="welcome__instruction">Carpeta o .zip descargado de Classroom 50</p>
            <BatchScanForm compact />
          </WelcomeCard>
        </div>
        <QuickAccess
          disabled={!!pendingUrl}
          onDemo={tryDemo}
          onOpenRecent={openRecent}
          recent={recent}
        />
        {open !== "group" && openError && !pendingUrl && (
          <p className="welcome__error welcome__error--page">{openError}</p>
        )}
        <div className="welcome__results batch">
          <BatchResults revealOnScan />
        </div>
      </main>
    </div>
  );
}
