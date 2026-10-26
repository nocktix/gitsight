import assert from "node:assert/strict";
import { test } from "node:test";
import { allCommitsOutsideWindow, missingArtifacts } from "../src/utils/emptyStates.ts";
import { TOUR_STEPS, hasSeenTour, markTourSeen, placeCard } from "../src/utils/tour.ts";
import { fakeLocalStorage } from "./fakeBackend.ts";

test("el recorrido tiene entre 4 y 7 pasos, todos con título, texto y elemento", () => {
  assert.ok(TOUR_STEPS.length >= 4 && TOUR_STEPS.length <= 7);
  for (const s of TOUR_STEPS) assert.ok(s.title && s.text && s.selector);
});

test("el recorrido solo se ofrece hasta que se ve", () => {
  fakeLocalStorage({});
  assert.equal(hasSeenTour(), false);
  markTourSeen();
  assert.equal(hasSeenTour(), true);
});

test("sin localStorage el recorrido no rompe la app", () => {
  const broken = () => {
    throw new Error("bloqueado");
  };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: broken, setItem: broken, removeItem: broken };
  assert.equal(hasSeenTour(), false);
  assert.doesNotThrow(() => markTourSeen());
});

test("la tarjeta va debajo del elemento, encima si no cabe, y siempre dentro de la pantalla", () => {
  const vp = { width: 1000, height: 700 };
  const card = { width: 340, height: 190 };
  assert.deepEqual(placeCard({ top: 50, bottom: 90, left: 100, width: 200 }, vp, card), { top: 102, left: 30 });
  assert.equal(placeCard({ top: 500, bottom: 660, left: 100, width: 200 }, vp, card).top, 500 - 12 - 190);
  // elemento muy alto: la tarjeta queda al pie de la pantalla
  assert.equal(placeCard({ top: 10, bottom: 690, left: 100, width: 200 }, vp, card).top, 700 - 190 - 12);
  // sin elemento: centrada
  assert.deepEqual(placeCard(null, vp, card), { top: 255, left: 330 });
  // pegada al borde derecho
  assert.equal(placeCard({ top: 50, bottom: 90, left: 950, width: 40 }, vp, card).left, 1000 - 340 - 12);
});

test("los commits están fuera de las fechas solo si todos lo están", () => {
  const days = ["2026-05-27", "2026-05-28"];
  assert.equal(allCommitsOutsideWindow(days, "2026-06-01", "2026-06-10"), true);
  assert.equal(allCommitsOutsideWindow(days, "2026-05-01", "2026-05-27"), false);
  assert.equal(allCommitsOutsideWindow(days, null, "2026-05-01"), true);
  assert.equal(allCommitsOutsideWindow([], "2026-05-01", "2026-05-27"), false);
  assert.equal(allCommitsOutsideWindow(days, null, null), false);
});

test("los archivos que faltan se nombran en lenguaje simple", () => {
  const items = [
    { expected: "bitacora_de_prompts.md", label: "la bitácora de prompts", found: false },
    { expected: "Autoria.md", label: "la declaración de autoría", found: true },
  ];
  assert.deepEqual(missingArtifacts(items), ["la bitácora de prompts (bitacora_de_prompts.md)"]);
  assert.deepEqual(missingArtifacts(items.map((i) => ({ ...i, found: true }))), []);
});
