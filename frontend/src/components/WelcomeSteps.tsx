import { useBatch } from "../context/useBatch";
import { useLlmConfig } from "../context/useLlmConfig";
import { modelStatus } from "../utils/llmConfig";
import { welcomeSteps } from "../utils/welcomeSteps";
import "./WelcomeSteps.css";

function Check() {
  return (
    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24" width="14">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function Warning() {
  return (
    <svg aria-hidden="true" className="welcome-steps__warn" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="16">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/**
 * Indicador liviano de pasos: círculos numerados unidos por una línea. Solo el paso 2 es un botón
 * (abre la ventana del modelo); el estado se lee por el ícono y el texto, no solo por el color.
 */
export default function WelcomeSteps() {
  const { store, openSettings } = useLlmConfig();
  const { scan } = useBatch();
  const steps = welcomeSteps(modelStatus(store), scan !== null);

  return (
    <ol aria-label="Pasos" className="welcome-steps">
      {steps.map((step) => {
        const label = (
          <>
            {step.icon === "warning" && <Warning />}
            {step.text}
          </>
        );
        return (
          <li
            aria-current={step.tone === "current" ? "step" : undefined}
            className={`welcome-steps__item welcome-steps__item--${step.tone}`}
            key={step.n}
          >
            <span aria-hidden="true" className="welcome-steps__circle">
              {step.icon === "check" ? <Check /> : step.n}
            </span>
            {step.action ? (
              <button className="welcome-steps__link" onClick={openSettings} title={`${step.text} · abrir la configuración del modelo de IA`} type="button">
                {label}
              </button>
            ) : (
              <span className="welcome-steps__text">{label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
