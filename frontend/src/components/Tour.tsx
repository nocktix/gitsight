import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTour } from "../context/useTour";
import { TOUR_STEPS, hasSeenTour, placeCard } from "../utils/tour";
import "./Tour.css";

const SPOTLIGHT_PADDING = 6;
const CARD_WIDTH = 340;
const CARD_HEIGHT = 190;

function targetRect(index: number): DOMRect | null {
  return findTarget(index)?.getBoundingClientRect() ?? null;
}

/** Lleva el elemento de un paso a la vista (con scroll suave salvo prefers-reduced-motion). */
function revealTarget(index: number): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  findTarget(index)?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

function findTarget(index: number): Element | null {
  const step = TOUR_STEPS[index];
  return (
    document.querySelector(step.selector) ??
    (step.fallback ? document.querySelector(step.fallback) : null)
  );
}

/** Lanza el recorrido la primera vez que se llega a la pantalla de trabajo. */
export function TourLauncher() {
  const { open, start } = useTour();
  useEffect(() => {
    if (!hasSeenTour()) start();
  }, [start]);
  return open ? <Tour /> : null;
}

/** Recorrido guiado: resalta un elemento por paso y explica para qué sirve. */
function Tour() {
  const { close } = useTour();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(() => targetRect(0));
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT);
  const last = index === TOUR_STEPS.length - 1;
  const step = TOUR_STEPS[index];

  const measure = useCallback(() => setRect(targetRect(index)), [index]);

  /** Cambia de paso: lo lleva a la vista y mide de inmediato; `settle` lo vuelve a medir al terminar el scroll. */
  const goTo = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(next, TOUR_STEPS.length - 1));
    setIndex(clamped);
    revealTarget(clamped);
    setRect(targetRect(clamped));
  }, []);

  useEffect(() => {
    revealTarget(0); // el primer paso también se lleva a la vista al abrir
  }, []);

  // El scroll suave tarda: se vuelve a medir cuando termina (y con cada scroll o cambio de tamaño).
  useEffect(() => {
    const settle = window.setTimeout(measure, 350);
    return () => window.clearTimeout(settle);
  }, [index, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);

  // La altura real de la tarjeta depende del texto del paso: se mide para que quepa en pantalla.
  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight;
    if (height && height !== cardHeight) setCardHeight(height);
  }, [index, cardHeight]);

  useEffect(() => nextRef.current?.focus(), [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") goTo(index + 1);
      else if (e.key === "ArrowLeft") goTo(index - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, goTo, index]);

  const pos = placeCard(
    rect,
    { width: window.innerWidth, height: window.innerHeight },
    { width: CARD_WIDTH, height: cardHeight },
  );

  return (
    <div className="tour">
      {rect && (
        <div
          className="tour__spotlight"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + 2 * SPOTLIGHT_PADDING,
            height: rect.height + 2 * SPOTLIGHT_PADDING,
          }}
        />
      )}
      {!rect && <div className="tour__veil" />}
      <div
        aria-label={`Recorrido guiado, paso ${index + 1} de ${TOUR_STEPS.length}`}
        className="tour__card"
        ref={cardRef}
        role="dialog"
        style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
      >
        <p className="tour__progress">
          Paso {index + 1} de {TOUR_STEPS.length}
        </p>
        <h2 className="tour__title">{step.title}</h2>
        <p className="tour__text">{step.text}</p>
        <div className="tour__actions">
          <button className="tour__skip" onClick={close} type="button">
            {last ? "Cerrar" : "Omitir"}
          </button>
          <span className="tour__nav">
            {index > 0 && (
              <button onClick={() => goTo(index - 1)} type="button">
                Anterior
              </button>
            )}
            <button
              className="tour__next"
              onClick={() => (last ? close() : goTo(index + 1))}
              ref={nextRef}
              type="button"
            >
              {last ? "Listo" : "Siguiente"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
