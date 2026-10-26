import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateRubricVersion,
  compareRubricVersions,
  createRubricVersion,
  getRubric,
  getTask,
  listRubricVersions,
  putGroups,
  putTask,
} from "../src/api/dbClient.ts";
import { fetchAnalysis } from "../src/api/analyzeClient.ts";
import { fakeFetch, unreachableFetch } from "./fakeBackend.ts";

test("las rutas parten el id de la tarea en owner/nombre", async () => {
  const calls = fakeFetch(() => ({ body: { version: 1 } }));
  await putTask("UAICL/tarea 02", "2026-05-01", "");
  await createRubricVersion("UAICL/tarea02", { content: "R", note: "n" });
  await putGroups("UAICL/tarea02", [{ url: "u", name: "n" }]);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["PUT", "/api/tasks/UAICL/tarea%2002"],
      ["POST", "/api/tasks/UAICL/tarea02/rubric/versions"],
      ["PUT", "/api/tasks/UAICL/tarea02/groups"],
    ],
  );
  assert.deepEqual(calls[0].body, { start_date: "2026-05-01", end_date: "" });
});

test("404 de tarea o rúbrica es 'no existe', no un error", async () => {
  fakeFetch(() => ({ status: 404, body: { detail: "no" } }));
  assert.equal(await getTask("UAICL/a"), null);
  assert.equal(await getRubric("UAICL/a"), null);
});

test("el error de FastAPI usa el campo detail", async () => {
  fakeFetch(() => ({ status: 409, body: { detail: "Estos grupos ya pertenecen a otra tarea" } }));
  await assert.rejects(putGroups("UAICL/a", []), { message: /ya pertenecen/ });
});

test("sin respuesta del backend: 'No se pudo conectar con el backend'", async () => {
  unreachableFetch();
  await assert.rejects(getTask("UAICL/a"), { message: "No se pudo conectar con el backend" });
  await assert.rejects(fetchAnalysis({ repo_url: "x" } as never), {
    message: "No se pudo conectar con el backend",
  });
});

test("fetchAnalysis envía task_id y rubric_version", async () => {
  const calls = fakeFetch(() => ({ body: { summary: "ok" } }));
  await fetchAnalysis({ repo_url: "x", task_id: "UAICL/a", rubric_version: 2 } as never);
  assert.equal(calls[0].url, "/api/analyze");
  assert.deepEqual(calls[0].body, { repo_url: "x", task_id: "UAICL/a", rubric_version: 2 });
});

test("las versiones de la rúbrica usan los endpoints de versiones", async () => {
  const calls = fakeFetch(() => ({ body: [] }));
  await listRubricVersions("UAICL/tarea02");
  await activateRubricVersion("UAICL/tarea02", 1);
  await compareRubricVersions("UAICL/tarea02", 1, 2);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", "/api/tasks/UAICL/tarea02/rubric/versions"],
      ["POST", "/api/tasks/UAICL/tarea02/rubric/versions/1/activate"],
      ["GET", "/api/tasks/UAICL/tarea02/rubric/compare?from=1&to=2"],
    ],
  );
});

test("subir una versión manda texto, archivo, nota y si se activa", async () => {
  const calls = fakeFetch(() => ({ body: { version: 2, created: true } }));
  await createRubricVersion("UAICL/tarea02", {
    content: "R2",
    filename: "rubrica.pdf",
    note: "agrega IA",
    activate: false,
  });
  assert.deepEqual(calls[0].body, {
    content: "R2",
    filename: "rubrica.pdf",
    note: "agrega IA",
    activate: false,
  });
});
