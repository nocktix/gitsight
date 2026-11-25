import assert from "node:assert/strict";
import { test } from "node:test";
import { createDateStore, decideDateCommit, isCommittableDate } from "../src/utils/taskDates.ts";
import type { TaskDates } from "../src/utils/taskDates.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("solo una fecha completa, real y de año razonable se puede guardar", () => {
  assert.equal(isCommittableDate("2026-11-24"), true);
  for (const bad of ["", "0002-11-24", "0020-11-24", "0202-11-24", "2026-02-30", "2101-01-01", "1899-12-31", "2026-1-5", "ayer"]) {
    assert.equal(isCommittableDate(bad), false, bad);
  }
});

test("escribir el año tecleando no guarda los valores intermedios; solo el final", () => {
  const saved: string[] = [];
  let current = "";
  for (const typed of ["0002-11-24", "0020-11-24", "0202-11-24", "2026-11-24"]) {
    if (decideDateCommit(typed, current, "change") === "save") {
      saved.push(typed);
      current = typed;
    }
  }
  assert.deepEqual(saved, ["2026-11-24"]);
});

test("al salir del campo: vacío borra, fecha a medias vuelve a lo guardado", () => {
  assert.equal(decideDateCommit("", "2026-11-24", "blur"), "save");
  assert.equal(decideDateCommit("", "", "blur"), "wait");
  assert.equal(decideDateCommit("0002-11-24", "2026-11-24", "blur"), "revert");
  assert.equal(decideDateCommit("", "2026-11-24", "change"), "wait"); // a medias mientras se escribe
  assert.equal(decideDateCommit("2026-11-24", "2026-11-24", "blur"), "wait");
});

/** Backend de mentira: guarda en orden de llegada y puede tardar o fallar por llamada. */
function setup(plan: { delay: number; fail?: boolean }[], reloadWorks = true) {
  let screen: TaskDates = { startDate: "", endDate: "" };
  let backend: TaskDates = { startDate: "", endDate: "" };
  const arrivals: string[] = [];
  const errors: unknown[] = [];
  let call = 0;
  const store = createDateStore({
    get: () => screen,
    set: (d) => (screen = d),
    save: async (d) => {
      const { delay, fail } = plan[call++] ?? { delay: 0 };
      await sleep(delay);
      if (fail) throw new Error("falló");
      arrivals.push(d.endDate);
      backend = d;
    },
    reload: async () => {
      if (!reloadWorks) throw new Error("sin backend");
      return backend;
    },
    onError: (e) => errors.push(e),
  });
  return { store, screen: () => screen, backend: () => backend, arrivals, errors };
}

test("los guardados llegan al backend en el orden en que se hicieron, aunque el primero tarde más", async () => {
  const t = setup([{ delay: 30 }, { delay: 1 }, { delay: 1 }]);
  t.store.change("endDate", "2026-11-20");
  t.store.change("endDate", "2026-11-22");
  t.store.change("endDate", "2026-11-24");
  await t.store.settled();
  assert.deepEqual(t.arrivals, ["2026-11-20", "2026-11-22", "2026-11-24"]);
  assert.equal(t.backend().endDate, "2026-11-24");
  assert.equal(t.screen().endDate, "2026-11-24");
});

test("un guardado viejo que falla no pisa la fecha más nueva ni avisa", async () => {
  const t = setup([{ delay: 5, fail: true }, { delay: 1 }]);
  t.store.change("endDate", "2026-11-20"); // fallará
  t.store.change("endDate", "2026-11-24"); // reemplaza al anterior
  await t.store.settled();
  assert.equal(t.screen().endDate, "2026-11-24");
  assert.equal(t.backend().endDate, "2026-11-24");
  assert.equal(t.errors.length, 0);
});

test("si falla el último guardado, la pantalla vuelve a lo que dice el backend y se avisa", async () => {
  const t = setup([{ delay: 1 }, { delay: 1, fail: true }]);
  t.store.change("endDate", "2026-11-20"); // se guarda
  t.store.change("endDate", "2026-11-24"); // falla
  await t.store.settled();
  assert.equal(t.backend().endDate, "2026-11-20");
  assert.equal(t.screen().endDate, "2026-11-20"); // una sola fuente: lo guardado
  assert.equal(t.errors.length, 1);
});

test("si además no se puede releer el backend, se restaura la fecha anterior", async () => {
  const t = setup([{ delay: 1, fail: true }], false);
  t.store.change("endDate", "2026-11-24");
  await t.store.settled();
  assert.equal(t.screen().endDate, "");
  assert.equal(t.errors.length, 1);
});

test("cambiar una fecha manda siempre las dos", async () => {
  const t = setup([{ delay: 1 }, { delay: 1 }]);
  t.store.change("startDate", "2026-03-02");
  t.store.change("endDate", "2026-03-06");
  await t.store.settled();
  assert.deepEqual(t.backend(), { startDate: "2026-03-02", endDate: "2026-03-06" });
});
