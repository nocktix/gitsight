import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDeadline, taskConfigSummary } from "../src/utils/taskConfigSummary.ts";

test("con entrega y rúbrica activa resume en una línea", () => {
  assert.deepEqual(taskConfigSummary({ endDate: "2026-11-09", rubric: "texto", rubricVersion: 2 }), {
    summary: "Entrega 09/11/2026 · Rúbrica v2 activa",
    missing: [],
  });
});

test("indica qué falta", () => {
  assert.deepEqual(taskConfigSummary({ endDate: "", rubric: null, rubricVersion: null }), {
    summary: "Falta la fecha de entrega y la rúbrica",
    missing: ["la fecha de entrega", "la rúbrica"],
  });
  assert.deepEqual(taskConfigSummary({ endDate: "2026-11-09", rubric: null, rubricVersion: null }).missing, ["la rúbrica"]);
  assert.deepEqual(taskConfigSummary({ endDate: "", rubric: "x", rubricVersion: 1 }).missing, ["la fecha de entrega"]);
});

test("formatDeadline tolera formatos inesperados", () => {
  assert.equal(formatDeadline("2026-01-05"), "05/01/2026");
  assert.equal(formatDeadline("mañana"), "mañana");
});
