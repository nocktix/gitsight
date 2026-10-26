import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAnalysisHistory } from "../src/utils/analysisStore.ts";
import { fakeFetch, unreachableFetch } from "./fakeBackend.ts";

const URL_A = "https://github.com/UAICL/a-x";

function row(id: number, rubric_version: number | null, summary: string, rubric_state = "version") {
  return {
    id,
    task_id: "UAICL/a",
    group_url: URL_A,
    rubric_version,
    rubric_state,
    model: "m",
    head_commit: null,
    created_at: `2026-05-0${id}T10:00:00.000000+00:00`,
    result: { summary },
  };
}

test("devuelve todo el historial del grupo, el más reciente primero", async () => {
  const calls = fakeFetch(() => ({ body: [row(2, 3, "nuevo"), row(1, 2, "viejo")] }));
  const history = await loadAnalysisHistory(URL_A);
  assert.deepEqual(
    history.map((a) => [a.id, a.rubricVersion, a.data.summary]),
    [[2, 3, "nuevo"], [1, 2, "viejo"]],
  );
  assert.equal(history[0].createdAt, "2026-05-02T10:00:00.000000+00:00");
  assert.equal(history[0].headCommit, null);
  assert.equal(calls[0].url, `/api/analyses?group_url=${encodeURIComponent(URL_A)}`);
});

test("un grupo sin análisis devuelve una lista vacía", async () => {
  fakeFetch(() => ({ body: [] }));
  assert.deepEqual(await loadAnalysisHistory(URL_A), []);
});

test("sin backend el error es claro, no un null silencioso", async () => {
  unreachableFetch();
  await assert.rejects(loadAnalysisHistory(URL_A), { message: "No se pudo conectar con el backend" });
});

test("conserva si el análisis fue sin rúbrica o con una versión desconocida", async () => {
  fakeFetch(() => ({
    body: [row(3, null, "a", "none"), row(2, null, "b", "unknown"), row(1, 1, "c")],
  }));
  const history = await loadAnalysisHistory(URL_A);
  assert.deepEqual(
    history.map((a) => [a.rubricVersion, a.rubricState]),
    [[null, "none"], [null, "unknown"], [1, "version"]],
  );
});
