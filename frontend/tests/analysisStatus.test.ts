import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisStatus } from "../src/utils/analysisStatus.ts";
import type { StoredAnalysis } from "../src/utils/analysisStore.ts";

const analysis = (over: Partial<StoredAnalysis> = {}): StoredAnalysis =>
  ({
    id: 1,
    data: {} as StoredAnalysis["data"],
    model: "gpt-4o",
    rubricVersion: 2,
    rubricState: "version",
    headCommit: "aaa",
    createdAt: "2026-11-05T15:19:00+00:00",
    ...over,
  }) as StoredAnalysis;

test("sin análisis: «Sin analizar»", () => {
  assert.deepEqual(analysisStatus(null, 2, null), { text: "Sin analizar", outdatedReasons: [] });
});

test("al día: fecha en hora de Chile y modelo", () => {
  const s = analysisStatus(analysis(), 2, new Set(["aaa"]));
  assert.match(s.text, /^Analizado el .+ con gpt-4o$/);
  assert.deepEqual(s.outdatedReasons, []);
});

test("desactualizado por rúbrica nueva", () => {
  assert.deepEqual(analysisStatus(analysis(), 3, new Set(["aaa"])).outdatedReasons, ["rúbrica nueva"]);
});

test("desactualizado por commits nuevos", () => {
  assert.deepEqual(analysisStatus(analysis(), 2, new Set(["bbb"])).outdatedReasons, ["commits nuevos"]);
});

test("sin rúbrica en la tarea no se avisa de rúbrica", () => {
  assert.deepEqual(analysisStatus(analysis({ rubricVersion: null, rubricState: "none" }), null, null).outdatedReasons, []);
});
