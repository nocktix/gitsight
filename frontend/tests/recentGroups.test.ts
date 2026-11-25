import assert from "node:assert/strict";
import { test } from "node:test";
import { addRecent, mergeRecents, recentLabel } from "../src/utils/recentGroups.ts";
import type { RecentGroup } from "../src/utils/recentGroups.ts";

const g = (n: number): RecentGroup => ({ taskId: "UAICL/tarea01", groupUrl: `https://github.com/UAICL/tarea01-e${n}`, name: `e${n}` });

test("addRecent pone el nuevo primero, sin repetir y con tope de 3", () => {
  let list: RecentGroup[] = [];
  for (const n of [1, 2, 3, 4]) list = addRecent(list, g(n));
  assert.deepEqual(list.map((x) => x.name), ["e4", "e3", "e2"]);
  assert.deepEqual(addRecent(list, g(2)).map((x) => x.name), ["e2", "e4", "e3"]);
});

test("mergeRecents completa con los guardados sin repetir", () => {
  assert.deepEqual(mergeRecents([g(1)], [g(1), g(2), g(3), g(4)]).map((x) => x.name), ["e1", "e2", "e3"]);
  assert.deepEqual(mergeRecents([], []), []);
  assert.deepEqual(mergeRecents([g(2), g(1)], []).map((x) => x.name), ["e2", "e1"]);
});

test("recentLabel muestra la tarea sin el dueño y el grupo", () => {
  assert.equal(recentLabel(g(1)), "tarea01 · e1");
});
