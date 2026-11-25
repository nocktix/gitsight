import assert from "node:assert/strict";
import { test } from "node:test";
import type { PanelState } from "../src/context/useAnalysis.ts";
import { stateAfterExternalAnalysis } from "../src/utils/analysisRefresh.ts";
import type { StoredAnalysis } from "../src/utils/analysisStore.ts";

function stored(id: number): StoredAnalysis {
  return {
    id,
    data: {} as StoredAnalysis["data"],
    model: "m",
    rubricVersion: 1,
    rubricState: "version",
    headCommit: null,
    createdAt: `2026-11-0${id}T10:00:00+00:00`,
  };
}

test("una vista vacía pasa a mostrar el análisis más reciente que guardó el lote", () => {
  const saved = [stored(2), stored(1)];
  assert.deepEqual(stateAfterExternalAnalysis({ status: "idle" }, saved), {
    status: "success",
    viewing: saved[0],
  });
});

test("también se actualiza si estaba leyendo o con un error", () => {
  const saved = [stored(1)];
  for (const prev of [{ status: "restoring" }, { status: "error", message: "x" }] as PanelState[]) {
    assert.equal(stateAfterExternalAnalysis(prev, saved).status, "success");
  }
});

test("no cambia lo que ve el evaluador si analiza o ya mira un resultado", () => {
  const saved = [stored(2), stored(1)];
  const loading: PanelState = { status: "loading" };
  const success: PanelState = { status: "success", viewing: stored(1) };
  assert.equal(stateAfterExternalAnalysis(loading, saved), loading);
  assert.equal(stateAfterExternalAnalysis(success, saved), success);
});

test("sin análisis guardados deja la vista como estaba", () => {
  const idle: PanelState = { status: "idle" };
  assert.equal(stateAfterExternalAnalysis(idle, []), idle);
});
