import assert from "node:assert/strict";
import { test } from "node:test";
import { scanFolder } from "../src/api/batchClient.ts";
import { BackendError, BackendUnreachableError } from "../src/api/http.ts";
import { classifyBatchError } from "../src/utils/batchErrors.ts";
import { runBatch } from "../src/utils/batchRun.ts";
import type { BatchErrorKind, BatchState } from "../src/utils/batchRun.ts";
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
  assert.deepEqual(result, { done: 3, failed: 0, cancelled: false, stopped: null });
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
  assert.deepEqual(result, { done: 2, failed: 1, cancelled: false, stopped: null });
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
  assert.deepEqual(result, { done: 1, failed: 0, cancelled: true, stopped: null });
  assert.deepEqual(log.filter(([i]) => i === 1).map(([, s]) => s), ["running", "pending"]);
  assert.equal(log.some(([i]) => i === 2), false);
});

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

test("con concurrencia analiza varios a la vez, sin pasarse del límite", async () => {
  const { onStatus } = recorder();
  let concurrent = 0;
  let maxConcurrent = 0;
  const result = await runBatch(
    ["a", "b", "c", "d", "e", "f", "g"],
    async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick(3);
      concurrent -= 1;
    },
    { onStatus, signal: new AbortController().signal, concurrency: 3 },
  );
  assert.equal(maxConcurrent, 3);
  assert.equal(result.done, 7);
});

test("con menos elementos que la concurrencia no lanza trabajadores de más", async () => {
  const { onStatus } = recorder();
  let maxConcurrent = 0;
  let concurrent = 0;
  await runBatch(
    ["a", "b"],
    async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick(2);
      concurrent -= 1;
    },
    { onStatus, signal: new AbortController().signal, concurrency: 5 },
  );
  assert.equal(maxConcurrent, 2);
});

test("un error que detiene el lote: no lanza nuevos, deja terminar a los que estaban en curso", async () => {
  const states: BatchState[] = [];
  const started: string[] = [];
  const result = await runBatch(
    ["a", "b", "c", "d", "e"],
    async (item) => {
      started.push(item);
      if (item === "a") {
        await tick(2);
        throw new Error("sin crédito");
      }
      await tick(10); // b y c siguen en curso cuando a falla
    },
    {
      onStatus: (i, s) => void (states[i] = s),
      signal: new AbortController().signal,
      concurrency: 3,
      classify: (err) => ((err as Error).message === "sin crédito" ? "stop" : "error"),
    },
  );
  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(states[0].status, "pending"); // el que falló por este motivo queda pendiente
  assert.equal(states[1].status, "done"); // los que estaban en curso terminan
  assert.equal(states[2].status, "done");
  assert.equal(states[3], undefined); // los que faltaban nunca se lanzaron
  assert.equal(result.done, 2);
  assert.equal(result.stopped?.index, 0);
  assert.equal(String(result.stopped?.error), "Error: sin crédito");
});

test("rate_limited: pasa a 'waiting', espera y reintenta hasta que funciona", async () => {
  const log: BatchState["status"][] = [];
  let attempts = 0;
  const result = await runBatch(
    ["a"],
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("límite");
    },
    {
      onStatus: (_, s) => void log.push(s.status),
      signal: new AbortController().signal,
      classify: () => "rate_limited" as BatchErrorKind,
      rateLimitWaitMs: 1,
    },
  );
  assert.equal(attempts, 3); // el primer intento y 2 reintentos
  assert.deepEqual(log, ["running", "waiting", "running", "waiting", "running", "done"]);
  assert.equal(result.done, 1);
  assert.equal(result.stopped, null);
});

test("rate_limited que no cede tras 2 reintentos detiene el lote y deja pendientes a los demás", async () => {
  const states: BatchState[] = [];
  let attempts = 0;
  const result = await runBatch(
    ["a", "b", "c"],
    async () => {
      attempts += 1;
      throw new Error("límite");
    },
    {
      onStatus: (i, s) => void (states[i] = s),
      signal: new AbortController().signal,
      classify: () => "rate_limited" as BatchErrorKind,
      rateLimitWaitMs: 1,
    },
  );
  assert.equal(attempts, 3);
  assert.equal(states[0].status, "pending");
  assert.equal(states[1], undefined);
  assert.equal(result.stopped?.index, 0);
  assert.equal(result.done + result.failed, 0);
});

test("cancelar mientras un grupo espera al proveedor lo devuelve a pendiente", async () => {
  const controller = new AbortController();
  const states: BatchState[] = [];
  const run = runBatch(
    ["a"],
    async () => {
      throw new Error("límite");
    },
    {
      onStatus: (i, s) => {
        states[i] = s;
        if (s.status === "waiting") setTimeout(() => controller.abort(), 1);
      },
      signal: controller.signal,
      classify: () => "rate_limited" as BatchErrorKind,
      rateLimitWaitMs: 60_000,
    },
  );
  const result = await run;
  assert.equal(states[0].status, "pending");
  assert.equal(result.cancelled, true);
  assert.equal(result.stopped, null);
});

test("classifyBatchError: qué detiene el lote, qué espera y qué solo marca al grupo", () => {
  const be = (code: string | null) => new BackendError("x", code);
  assert.equal(classifyBatchError(be("rate_limited")), "rate_limited");
  for (const code of ["no_credit_or_rate_limit", "invalid_api_key", "model_not_found", "llm_not_configured", "provider_unreachable"]) {
    assert.equal(classifyBatchError(be(code)), "stop", code);
  }
  assert.equal(classifyBatchError(new BackendUnreachableError()), "stop");
  for (const code of ["provider_error", "timeout", "llm_invalid_response_format", null]) {
    assert.equal(classifyBatchError(be(code)), "error", String(code));
  }
  assert.equal(classifyBatchError(new Error("repo dañado")), "error");
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
