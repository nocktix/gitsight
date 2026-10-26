import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateGhostTasks, readLast, readTask, readTaskIds } from "../src/utils/storage.ts";

function fakeLocalStorage(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
}

test("fusiona la tarea fantasma en la real y conserva rúbrica, fechas y grupos", () => {
  const ghost = "UAICL/tarea02-demo-trio-de";
  const real = "UAICL/tarea02-demo";
  const ghostUrl = "https://github.com/UAICL/tarea02-demo-trio-de-prueba";
  const data = fakeLocalStorage({
    "tid.tasks": [real, ghost],
    [`tid.task.${real}`]: { rubric: null, startDate: "", endDate: "2026-05-01", groups: [], lastGroupUrl: null },
    [`tid.task.${ghost}`]: {
      rubric: "R",
      startDate: "2026-04-01",
      endDate: "2026-06-01",
      groups: [{ url: ghostUrl, name: "prueba" }],
      lastGroupUrl: ghostUrl,
    },
    "tid.last": { taskId: ghost, groupUrl: ghostUrl },
  });

  migrateGhostTasks();

  assert.deepEqual(readTaskIds(), [real]);
  assert.equal(data.has(`tid.task.${ghost}`), false);
  assert.deepEqual(readTask(real), {
    rubric: "R",
    startDate: "2026-04-01",
    endDate: "2026-05-01", // la fecha de la tarea real manda
    groups: [{ url: ghostUrl, name: "trio-de-prueba" }],
    lastGroupUrl: ghostUrl,
    rubricVersion: null,
  });
  assert.equal(readLast()?.taskId, real);
  assert.ok(data.has("tid.backup.v1"));
});

test("corre una sola vez", () => {
  fakeLocalStorage({ "tid.tasks": ["UAICL/a", "UAICL/a-b"], "tid.migrated.v1": true });
  migrateGhostTasks();
  assert.deepEqual(readTaskIds(), ["UAICL/a", "UAICL/a-b"]);
});
