import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRepoUrl } from "../src/utils/repoUrl.ts";
import { INVALID_URL_TEXT, checkRepoUrl, visibleCheck } from "../src/utils/repoUrlCheck.ts";

const URL_ = "https://github.com/UAICL/tarea02-demo-equipo1";

test("vacío no muestra nada", () => {
  assert.deepEqual(checkRepoUrl("  ", null), { kind: "empty" });
});

test("URL válida con tarea conocida: tarea y grupo, sin aviso de confirmación", () => {
  const parsed = parseRepoUrl(URL_, ["UAICL/tarea02-demo"]);
  assert.deepEqual(checkRepoUrl(URL_, parsed), {
    kind: "valid",
    text: "✓ Tarea: UAICL/tarea02-demo · Grupo: equipo1",
  });
});

test("tarea no conocida: usa la misma deducción y avisa que se pedirá confirmar", () => {
  const parsed = parseRepoUrl(URL_);
  assert.ok(parsed && !parsed.taskIsKnown);
  assert.deepEqual(checkRepoUrl(URL_, parsed), {
    kind: "valid",
    text: "✓ Tarea: UAICL/tarea02-demo · Grupo: equipo1 · te pediremos confirmar la tarea",
  });
});

test("URL mal formada: mensaje de ejemplo", () => {
  for (const bad of ["https://git", "github.com/a/b", "https://gitlab.com/a/b", "hola"]) {
    assert.deepEqual(checkRepoUrl(bad, parseRepoUrl(bad)), { kind: "invalid", text: INVALID_URL_TEXT });
  }
});

test("el error solo se ve tras salir del campo o pulsar Enter; lo válido, siempre", () => {
  const bad = checkRepoUrl("https://git", null);
  assert.equal(visibleCheck(bad, false), null);
  assert.deepEqual(visibleCheck(bad, true), bad);
  const ok = checkRepoUrl(URL_, parseRepoUrl(URL_));
  assert.deepEqual(visibleCheck(ok, false), ok);
  assert.equal(visibleCheck({ kind: "empty" }, true), null);
});
