import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSummary, getSavedSummary } from "../src/api/commitSummaryClient.ts";
import { coverageNote, messageCheckLabel, statsLine } from "../src/utils/summaryView.ts";
import { fakeFetch, unreachableFetch } from "./fakeBackend.ts";

const URL_A = "https://github.com/UAICL/tarea02-ana";
const HASH = "a".repeat(40);
const summary = { summary: "Agrega la clase Batalla.", model: "m", cached: true };

test("consultar lo guardado usa GET con la URL del repo y no genera nada", async () => {
  const calls = fakeFetch(() => ({ body: summary }));
  assert.deepEqual(await getSavedSummary(URL_A, HASH), summary);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, `/api/commits/${HASH}/summary?repo_url=${encodeURIComponent(URL_A)}`);
});

test("un 404 significa 'todavía no hay resumen', no un error", async () => {
  fakeFetch(() => ({ status: 404, body: { detail: "Este commit no tiene resumen guardado." } }));
  assert.equal(await getSavedSummary(URL_A, HASH), null);
});

test("otros errores al consultar se informan, p. ej. hash corto ambiguo", async () => {
  fakeFetch(() => ({ status: 409, body: { detail: "coincide con más de un commit guardado" } }));
  await assert.rejects(getSavedSummary(URL_A, HASH), { message: /más de un commit/ });
});

test("generar envía POST con regenerate false; regenerar, con true", async () => {
  const calls = fakeFetch(() => ({ body: summary }));
  await generateSummary(URL_A, HASH, false);
  await generateSummary(URL_A, HASH, true);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ["POST", `/api/commits/${HASH}/summary`, { repo_url: URL_A, regenerate: false }],
      ["POST", `/api/commits/${HASH}/summary`, { repo_url: URL_A, regenerate: true }],
    ],
  );
});

test("el error del LLM (502) llega con el mensaje del backend", async () => {
  fakeFetch(() => ({ status: 502, body: { error: "llm_provider_unavailable", message: "El modelo no está disponible" } }));
  await assert.rejects(generateSummary(URL_A, HASH, false), { message: "El modelo no está disponible" });
});

test("sin backend: 'No se pudo conectar con el backend'", async () => {
  unreachableFetch();
  await assert.rejects(getSavedSummary(URL_A, HASH), { message: "No se pudo conectar con el backend" });
  await assert.rejects(generateSummary(URL_A, HASH, false), { message: "No se pudo conectar con el backend" });
});

test("aviso de cobertura: solo cuando se analizó una parte del diff", () => {
  const full = { truncated: false, files_total: 3, files_complete: 3, files_partial: 0, files_omitted: 0 };
  assert.equal(coverageNote(full), null);
  assert.equal(
    coverageNote({ truncated: true, files_total: 4, files_complete: 1, files_partial: 1, files_omitted: 2 }),
    "Se analizó solo una parte del diff: 1 de 4 archivos completos, 1 recortados, 2 sin contenido.",
  );
  assert.equal(
    coverageNote({ truncated: true, files_total: 2, files_complete: 1, files_partial: 1, files_omitted: 0 }),
    "Se analizó solo una parte del diff: 1 de 2 archivos completos, 1 recortados.",
  );
});

test("etiquetas del mensaje: el genérico no se presenta como 'no coincide'", () => {
  assert.equal(messageCheckLabel("coincide"), "El mensaje coincide con los cambios");
  assert.equal(messageCheckLabel("no_coincide"), "El mensaje no coincide con los cambios");
  assert.match(messageCheckLabel("mensaje_generico"), /genérico/);
  assert.doesNotMatch(messageCheckLabel("mensaje_generico"), /no coincide/);
});

test("línea de cantidades", () => {
  assert.equal(statsLine({ files: 1, insertions: 2, deletions: 0 }), "1 archivo · +2 −0 líneas");
  assert.equal(statsLine({ files: 3, insertions: 10, deletions: 4 }), "3 archivos · +10 −4 líneas");
});
