import assert from "node:assert/strict";
import { test } from "node:test";
import type { RubricVersion } from "../src/api/dbClient.ts";
import {
  LOCAL_TASK_NOTE,
  MODEL_SAVED_NOTICE,
  NO_RUBRIC_WARNING,
  RUBRIC_LOCKED_TEXT,
  RUBRIC_SAVED_NOTICE,
  gateAnalyze,
  isLocalTask,
  rubricActions,
  rubricBlockState,
} from "../src/utils/batchGate.ts";

const version = (over: Partial<RubricVersion>): RubricVersion => ({
  task_id: "UAICL/t1",
  version: 1,
  created_at: "2026-10-26T12:00:00Z",
  filename: null,
  note: null,
  active: false,
  criteria_count: null,
  ...over,
});

// --- verificación al presionar "Analizar todos" -------------------------------------------

test("sin modelo no parte el lote: se abre la configuración, haya rúbrica o no", () => {
  assert.equal(gateAnalyze({ hasModel: false, hasRubric: false }), "need-model");
  assert.equal(gateAnalyze({ hasModel: false, hasRubric: true }), "need-model");
});

test("con modelo y sin rúbrica activa se pregunta antes de partir", () => {
  assert.equal(gateAnalyze({ hasModel: true, hasRubric: false }), "need-rubric");
});

test("con modelo y rúbrica parte sin diálogos extra", () => {
  assert.equal(gateAnalyze({ hasModel: true, hasRubric: true }), "go");
});

test("los textos de la verificación son los acordados", () => {
  assert.equal(
    NO_RUBRIC_WARNING,
    "Esta tarea no tiene rúbrica. Los hallazgos no se organizarán por criterio.",
  );
  assert.equal(MODEL_SAVED_NOTICE, "Modelo guardado. Presiona Analizar todos para empezar.");
  assert.equal(RUBRIC_SAVED_NOTICE, "Rúbrica guardada. Presiona Analizar todos para empezar.");
});

// --- bloque "Rúbrica de la tarea" ---------------------------------------------------------

test("sin versiones la tarea no tiene rúbrica", () => {
  assert.deepEqual(rubricBlockState([]), { kind: "none" });
});

test("versiones guardadas pero ninguna activa también cuenta como sin rúbrica", () => {
  assert.deepEqual(rubricBlockState([version({ version: 1, active: false })]), { kind: "none" });
});

test("con rúbrica activa muestra la versión y el nombre del archivo", () => {
  const state = rubricBlockState([
    version({ version: 1, filename: "vieja.pdf" }),
    version({ version: 2, filename: "rubrica.pdf", active: true }),
  ]);
  assert.deepEqual(state, { kind: "active", version: 2, label: "Versión 2 activa · rubrica.pdf" });
});

test("si se pegó el texto, en lugar del archivo muestra la fecha en hora de Chile", () => {
  const state = rubricBlockState([version({ version: 3, active: true })]);
  assert.equal(state.kind, "active");
  if (state.kind === "active") assert.equal(state.label, "Versión 3 activa · 26-10-2026 09:00");
});

test("tarea local/... se detecta para mostrar la nota", () => {
  assert.equal(isLocalTask("local/tarea01"), true);
  assert.equal(isLocalTask("UAICL/tarea01"), false);
  assert.equal(
    LOCAL_TASK_NOTE,
    "Esta tarea es local: la rúbrica no se compartirá con grupos abiertos por URL.",
  );
});

// --- bloqueo mientras el lote corre -------------------------------------------------------

test("con el lote detenido se puede agregar y cambiar la rúbrica", () => {
  assert.deepEqual(rubricActions(false), {
    canView: true,
    canAdd: true,
    canChange: true,
    lockedText: null,
  });
});

test("con el lote corriendo no se agrega ni se cambia, pero sí se ve", () => {
  assert.deepEqual(rubricActions(true), {
    canView: true,
    canAdd: false,
    canChange: false,
    lockedText: "No se puede cambiar la rúbrica mientras se analiza el lote",
  });
  assert.equal(RUBRIC_LOCKED_TEXT, rubricActions(true).lockedText);
});
