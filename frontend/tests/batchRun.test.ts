import assert from "node:assert/strict";
import { test } from "node:test";
import { scanFolder } from "../src/api/batchClient.ts";
import { runBatch } from "../src/utils/batchRun.ts";
import type { BatchState } from "../src/utils/batchRun.ts";
import { fakeFetch } from "./fakeBackend.ts";

function recorder() {
  const log: [number, BatchState["status"]][] = [];
  return { log, onStatus: (i: number, s: BatchState) => void log.push([i, s.status]) };
}

test("analiza de a un grupo, en orden, y nunca dos a la vez", async () => {
  const { log, onStatus } = recorder();
  let concurrent = 0;
  let maxConcurrent = 0;
  const order: string[] = [];
  const result = await runBatch(
    ["a", "b", "c"],
    async (item) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 1));
      order.push(item);
      concurrent -= 1;
    },
    { onStatus, signal: new AbortController().signal },
  );
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual(result, { done: 3, failed: 0, cancelled: false });
  assert.deepEqual(log.slice(0, 2), [[0, "running"], [0, "done"]]);
});

test("si un grupo falla, lo anota y sigue con los demás", async () => {
  const { log, onStatus } = recorder();
  const states: BatchState[] = [];
  const result = await runBatch(
    ["a", "b", "c"],
    async (item) => {
      if (item === "b") throw new Error("La API key es inválida");
    },
    { onStatus: (i, s) => { onStatus(i, s); states[i] = s; }, signal: new AbortController().signal },
  );
  assert.deepEqual(result, { done: 2, failed: 1, cancelled: false });
  assert.deepEqual(states[1], { status: "error", message: "La API key es inválida" });
  assert.equal(states[2].status, "done");
  assert.deepEqual(log.filter(([i]) => i === 2).map(([, s]) => s), ["running", "done"]);
});

test("cancelar aborta el grupo en curso (vuelve a pendiente) y no lanza los siguientes", async () => {
  const controller = new AbortController();
  const { log, onStatus } = recorder();
  const started: string[] = [];
  const result = await runBatch(
    ["a", "b", "c"],
    (item, signal) => {
      started.push(item);
      if (item === "a") return Promise.resolve();
      return new Promise<void>((_, reject) => {
        controller.abort();
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("abortado"), { name: "AbortError" })),
        );
        if (signal.aborted) reject(Object.assign(new Error("abortado"), { name: "AbortError" }));
      });
    },
    { onStatus, signal: controller.signal },
  );
  assert.deepEqual(started, ["a", "b"]);
  assert.deepEqual(result, { done: 1, failed: 0, cancelled: true });
  assert.deepEqual(log.filter(([i]) => i === 1).map(([, s]) => s), ["running", "pending"]);
  assert.equal(log.some(([i]) => i === 2), false);
});

test("scanFolder manda la carpeta y traduce la respuesta", async () => {
  const calls = fakeFetch(() => ({
    body: {
      task_id: "UAICL/c50-t1",
      warnings: ["aviso"],
      groups: [
        { name: "ana", url: "https://github.com/UAICL/c50-t1-ana", path: "/d/c50-t1-ana", has_origin: true, commits: 4 },
        { name: "beto", url: "/d/c50-t1-beto", path: "/d/c50-t1-beto", has_origin: false, commits: null },
      ],
    },
  }));
  const scan = await scanFolder("/d");
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].body], ["POST", "/api/batch/scan", { folder: "/d" }]);
  assert.equal(scan.taskId, "UAICL/c50-t1");
  assert.deepEqual(scan.warnings, ["aviso"]);
  assert.deepEqual(scan.groups.map((g) => [g.name, g.hasOrigin, g.commits]), [["ana", true, 4], ["beto", false, null]]);
});

test("scanFolder muestra el mensaje del backend si la carpeta no sirve", async () => {
  fakeFetch(() => ({ status: 400, body: { detail: "La carpeta no existe." } }));
  await assert.rejects(scanFolder("/nada"), /La carpeta no existe\./);
});
