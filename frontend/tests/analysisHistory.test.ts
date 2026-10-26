import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analysisNotices,
  formatSantiago,
  historyLabel,
  latestCommitHashes,
  rubricLabel,
  rubricNotice,
} from "../src/utils/analysisHistory.ts";
import type { StoredAnalysis } from "../src/utils/analysisStore.ts";
import type { CommitsData } from "../src/types/commits.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

function analysis(over: Partial<StoredAnalysis> = {}): StoredAnalysis {
  return {
    id: 1,
    data: {} as StoredAnalysis["data"],
    model: "nemotron",
    rubricVersion: 2,
    rubricState: "version",
    headCommit: HEAD,
    createdAt: "2026-05-27T13:00:00.000000+00:00",
    ...over,
  };
}

function commitsData(commits: [string, string][]): CommitsData {
  return {
    authorDailyContributionsMap: {
      ana: commits.map(([hash, authoredAt]) => ({
        date: authoredAt.slice(0, 10),
        commitResults: [{ hash, authoredAt }],
      })),
    },
  } as unknown as CommitsData;
}

test("la fecha se muestra en hora de Chile, con horario de invierno y de verano", () => {
  assert.equal(formatSantiago("2026-05-27T13:00:00.000000+00:00"), "27-05-2026 09:00"); // UTC-4
  assert.equal(formatSantiago("2026-01-15T13:00:00.000000+00:00"), "15-01-2026 10:00"); // UTC-3
  assert.equal(formatSantiago("2026-05-28T02:30:00+00:00"), "27-05-2026 22:30"); // día anterior
});

test("etiquetas del selector: fecha, modelo y rúbrica o 'sin rúbrica'", () => {
  assert.equal(rubricLabel(analysis({ rubricVersion: null, rubricState: "none" })), "sin rúbrica");
  assert.equal(
    rubricLabel(analysis({ rubricVersion: null, rubricState: "unknown" })),
    "versión de rúbrica desconocida",
  );
  assert.equal(rubricLabel(analysis()), "rúbrica v2");
  assert.equal(
    historyLabel(analysis(), true),
    "27-05-2026 09:00 · nemotron · rúbrica v2 (más reciente)",
  );
  assert.equal(
    historyLabel(analysis({ rubricVersion: null, rubricState: "none" }), false),
    "27-05-2026 09:00 · nemotron · sin rúbrica",
  );
});

test("el último commit es el de mayor fecha, aunque cambie el offset", () => {
  const data = commitsData([
    [OLD, "2026-05-27T09:00:00-04:00"],
    [HEAD, "2026-05-27T10:00:00-04:00"],
  ]);
  assert.deepEqual([...latestCommitHashes(data)!], [HEAD]);
  const tie = commitsData([
    [OLD, "2026-05-27T10:00:00-04:00"],
    [HEAD, "2026-05-27T10:00:00-04:00"],
  ]);
  assert.deepEqual([...latestCommitHashes(tie)!].sort(), [HEAD, OLD]);
  assert.equal(latestCommitHashes(commitsData([])), null);
});

test("aviso de rúbrica distinta a la activa, con su texto exacto", () => {
  assert.equal(rubricNotice(analysis({ rubricVersion: 1 }), 3), "Hecho con una rúbrica anterior (v1)");
  assert.equal(rubricNotice(analysis({ rubricVersion: 3 }), 3), null);
  // se reactivó una versión antigua: el análisis es de una más nueva, no "anterior"
  assert.equal(
    rubricNotice(analysis({ rubricVersion: 3 }), 1),
    "Hecho con la rúbrica v3, distinta de la activa (v1)",
  );
});

test("sin rúbrica y versión desconocida también avisan si la tarea tiene rúbrica activa", () => {
  const none = analysis({ rubricVersion: null, rubricState: "none" });
  const unknown = analysis({ rubricVersion: null, rubricState: "unknown" });
  assert.equal(rubricNotice(none, 2), "Hecho sin rúbrica");
  assert.equal(rubricNotice(unknown, 2), "Hecho con una rúbrica de versión desconocida");
  // sin rúbrica activa no hay con qué comparar
  assert.equal(rubricNotice(none, null), null);
  assert.equal(rubricNotice(unknown, null), null);
  assert.equal(rubricNotice(analysis(), null), null);
});

test("aviso de commits posteriores solo si el head guardado no es el último", () => {
  const notice = "El repo tiene commits posteriores a este análisis";
  assert.deepEqual(analysisNotices(analysis(), new Set([OLD])), [notice]);
  assert.deepEqual(analysisNotices(analysis(), new Set([HEAD])), []);
  assert.deepEqual(analysisNotices(analysis(), new Set([OLD, HEAD])), []);
});

test("los análisis importados (sin head_commit) no muestran el aviso de commits", () => {
  assert.deepEqual(analysisNotices(analysis({ headCommit: null }), new Set([OLD])), []);
});

test("sin datos de commits no se avisa nada sobre commits", () => {
  assert.deepEqual(analysisNotices(analysis(), null), []);
});
