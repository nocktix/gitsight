import assert from "node:assert/strict";
import { test } from "node:test";
import { saveTaskRubricVersion } from "../src/utils/storage.ts";
import { fakeFetch } from "./fakeBackend.ts";

test("guardar una rúbrica desde el lote crea una versión de la tarea escaneada y no analiza nada", async () => {
  const calls = fakeFetch(() => ({
    body: { version: 1, active: true, created: true, content: "Criterio 1", task_id: "UAICL/t1" },
  }));
  const saved = await saveTaskRubricVersion("UAICL/t1", "Criterio 1", {
    filename: "rubrica.pdf",
    note: null,
  });
  assert.equal(saved.version, 1);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [["POST", "/api/tasks/UAICL/t1/rubric/versions"]],
  );
  assert.deepEqual(calls[0].body, { content: "Criterio 1", filename: "rubrica.pdf", note: null });
  assert.ok(!calls.some((c) => c.url.includes("/api/analyze")));
});

test("una tarea local/... guarda su rúbrica en su propia ruta", async () => {
  const calls = fakeFetch(() => ({ body: { version: 1, active: true, created: true, content: "R" } }));
  await saveTaskRubricVersion("local/tarea01", "R");
  assert.equal(calls[0].url, "/api/tasks/local/tarea01/rubric/versions");
});
