// Ejecutar con: npm test  (usa el runner integrado de Node, sin dependencias extra)
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRepoUrl } from "../src/utils/repoUrl.ts";

const BASE = "https://github.com/UAICL/";

test("sin tareas conocidas se quita el último segmento", () => {
  const p = parseRepoUrl(`${BASE}tarea02-demo-equipo1`)!;
  assert.equal(p.taskId, "UAICL/tarea02-demo");
  assert.equal(p.group, "equipo1");
  assert.equal(p.taskIsKnown, false);
});

test("equipo con guion: sin tarea conocida se parte mal (por eso se pide confirmar)", () => {
  const p = parseRepoUrl(`${BASE}tarea02-demo-uno-dos-y-tres-cuatro`)!;
  assert.equal(p.taskId, "UAICL/tarea02-demo-uno-dos-y-tres");
  assert.equal(p.group, "cuatro");
  assert.equal(p.taskIsKnown, false);
});

test("uno-dos-y-tres-cuatro usa la tarea ya conocida", () => {
  const p = parseRepoUrl(`${BASE}tarea02-demo-uno-dos-y-tres-cuatro`, [
    "UAICL/tarea02-demo",
  ])!;
  assert.equal(p.taskId, "UAICL/tarea02-demo");
  assert.equal(p.group, "uno-dos-y-tres-cuatro");
  assert.equal(p.taskIsKnown, true);
});

test("sin tarea conocida usa el prefijo común con repos ya cargados del mismo owner", () => {
  const loaded = [`${BASE}tarea02-demo-equipo1`, "https://github.com/OTRA/tarea02-x-y"];
  const p = parseRepoUrl(`${BASE}tarea02-demo-trio-de-prueba`, [], undefined, loaded)!;
  assert.equal(p.taskId, "UAICL/tarea02-demo");
  assert.equal(p.group, "trio-de-prueba");
  assert.equal(p.taskIsKnown, false); // sigue pidiendo confirmación
});

test("el prefijo común no cruza owners ni consume todo el repo", () => {
  const loaded = ["https://github.com/OTRA/tarea02-demo-x", `${BASE}tarea02`];
  const p = parseRepoUrl(`${BASE}tarea02-demo-trio-de-prueba`, [], undefined, loaded)!;
  assert.equal(p.taskId, "UAICL/tarea02-demo-trio-de");
});

test("si calzan varias tareas conocidas, gana la más larga", () => {
  const p = parseRepoUrl(`${BASE}tarea02-demo-uno-dos`, [
    "UAICL/tarea02",
    "UAICL/tarea02-demo",
    "UAICL/tarea02-demo",
  ])!;
  assert.equal(p.taskId, "UAICL/tarea02-demo");
  assert.equal(p.group, "uno-dos");
});

test("una tarea conocida de otro dueño no calza", () => {
  const p = parseRepoUrl("https://github.com/OTRA/tarea02-demo-x", [
    "UAICL/tarea02-demo",
  ])!;
  assert.equal(p.taskId, "OTRA/tarea02-demo");
});

test("un nombre que solo comparte letras con la tarea no calza", () => {
  const p = parseRepoUrl(`${BASE}tarea02-demol-x`, ["UAICL/tarea02-demo"])!;
  assert.equal(p.taskId, "UAICL/tarea02-demol");
});

test("corrección manual de la tarea", () => {
  const url = `${BASE}tarea02-demo-uno-dos-y-tres-cuatro`;
  const p = parseRepoUrl(url, [], "UAICL/tarea02-demo")!;
  assert.equal(p.group, "uno-dos-y-tres-cuatro");
  assert.equal(parseRepoUrl(url, [], "UAICL/otra-cosa"), null);
});

test("repo sin guion: tarea y grupo son el repo completo", () => {
  const p = parseRepoUrl(`${BASE}proyecto`)!;
  assert.equal(p.taskId, "UAICL/proyecto");
  assert.equal(p.group, "proyecto");
});

test("URLs inválidas", () => {
  assert.equal(parseRepoUrl("https://example.com/foo"), null);
  assert.equal(parseRepoUrl("hola"), null);
});
