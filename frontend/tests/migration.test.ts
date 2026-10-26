import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { resetMigrationCache, runMigrationOnce } from "../src/utils/storage.ts";
import { fakeFetch, fakeLocalStorage, unreachableFetch } from "./fakeBackend.ts";

const TASK = "UAICL/tarea02";
const URL_A = "https://github.com/UAICL/tarea02-ana";
const counts = {
  tasks: 1,
  rubrics: 1,
  groups: 1,
  analyses: 1,
  analyses_skipped_duplicate: 0,
  analyses_skipped_unknown_group: [],
};
const analysis = { data: { summary: "ok", timestamp: "2026-05-01T10:00:00" }, rubric: "R" };

function legacyStorage() {
  return fakeLocalStorage({
    "tid.tasks": [TASK],
    [`tid.task.${TASK}`]: {
      rubric: "R",
      startDate: "2026-05-01",
      endDate: "2026-05-30",
      groups: [{ url: URL_A, name: "ana" }],
      lastGroupUrl: URL_A,
    },
    [`tid.analysis.${URL_A}`]: analysis,
  });
}

beforeEach(resetMigrationCache);

test("envía lo de localStorage a /api/import, devuelve los conteos y marca como migrado", async () => {
  const data = legacyStorage();
  const calls = fakeFetch(() => ({ body: counts }));
  assert.deepEqual(await runMigrationOnce(), counts);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/import");
  assert.deepEqual(calls[0].body, {
    tasks: {
      [TASK]: {
        rubric: "R",
        startDate: "2026-05-01",
        endDate: "2026-05-30",
        groups: [{ url: URL_A, name: "ana" }],
      },
    },
    analyses: { [URL_A]: analysis },
  });
  assert.equal(data.get("tid.migrated.db.v1"), "true");
});

test("no borra nada de localStorage", async () => {
  const data = legacyStorage();
  const before = [...data.keys()];
  fakeFetch(() => ({ body: counts }));
  await runMigrationOnce();
  for (const key of before) assert.ok(data.has(key), key);
});

test("una vez marcada no vuelve a importar", async () => {
  const data = legacyStorage();
  data.set("tid.migrated.db.v1", "true");
  const calls = fakeFetch(() => ({ body: counts }));
  assert.equal(await runMigrationOnce(), null);
  assert.equal(calls.length, 0);
});

test("si el backend no responde no se marca y el siguiente intento reintenta", async () => {
  const data = legacyStorage();
  unreachableFetch();
  await assert.rejects(runMigrationOnce(), { message: "No se pudo conectar con el backend" });
  assert.equal(data.has("tid.migrated.db.v1"), false);

  const calls = fakeFetch(() => ({ body: counts }));
  assert.deepEqual(await runMigrationOnce(), counts);
  assert.equal(calls.length, 1);
});

test("llamadas simultáneas comparten una sola importación", async () => {
  legacyStorage();
  const calls = fakeFetch(() => ({ body: counts }));
  const [a, b] = await Promise.all([runMigrationOnce(), runMigrationOnce()]);
  assert.deepEqual(a, counts);
  assert.deepEqual(b, counts);
  assert.equal(calls.length, 1);
});

test("sin datos antiguos no llama al backend y queda marcado", async () => {
  const data = fakeLocalStorage({});
  const calls = fakeFetch(() => ({ body: counts }));
  assert.equal(await runMigrationOnce(), null);
  assert.equal(calls.length, 0);
  assert.equal(data.get("tid.migrated.db.v1"), "true");
});
