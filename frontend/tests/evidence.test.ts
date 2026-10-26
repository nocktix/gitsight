import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchArtifact } from "../src/api/artifactsClient.ts";
import type { Finding } from "../src/types/analyze.ts";
import { citedCommits, evidenceLabel, lineRange, showNoEvidenceLabel } from "../src/utils/evidence.ts";
import { fakeFetch } from "./fakeBackend.ts";

const HASH = "a3f9c1d" + "0".repeat(33);
const finding = (over: Partial<Finding> = {}): Finding => ({
  type: "info",
  criterion: null,
  title: "t",
  description: "d",
  ...over,
});

test("los chips usan los nombres de la interfaz", () => {
  assert.equal(evidenceLabel({ type: "commit", hash: HASH }), "commit a3f9c1");
  assert.equal(evidenceLabel({ type: "prompt_log", line_start: 12, line_end: 18 }), "Bitácora L12–18");
  assert.equal(evidenceLabel({ type: "authorship", line_start: 4, line_end: 4 }), "Autoría L4");
  assert.equal(lineRange(3, 3), "L3");
});

test("los commits citados son los hashes completos del hallazgo", () => {
  const f = finding({
    evidence: [
      { type: "commit", hash: HASH },
      { type: "authorship", line_start: 1, line_end: 2 },
    ],
  });
  assert.deepEqual([...citedCommits(f)!], [HASH]);
  assert.equal(citedCommits(finding({ evidence: [{ type: "authorship", line_start: 1, line_end: 1 }] })), null);
  assert.equal(citedCommits(finding()), null);
});

test("'sin evidencia vinculada' solo con evidencia vacía en análisis nuevos", () => {
  assert.equal(showNoEvidenceLabel(finding({ evidence: [] })), true);
  // análisis antiguo: el campo no existe
  assert.equal(showNoEvidenceLabel(finding()), false);
  // con evidencia
  assert.equal(showNoEvidenceLabel(finding({ evidence: [{ type: "commit", hash: HASH }] })), false);
  // artefacto que falta o con otro nombre
  assert.equal(showNoEvidenceLabel(finding({ evidence: [], no_evidence_needed: true })), false);
});

test("fetchArtifact pide el archivo por tipo y devuelve el nombre real", async () => {
  const body = {
    kind: "prompt_log", exists: true, expected_filename: "bitacora_de_prompts.md",
    filename: "bitacora_de_propts.md", renamed: true, other_candidates: [], lines: ["a", "b"],
  };
  const calls = fakeFetch(() => ({ body }));
  const data = await fetchArtifact("prompt_log", "https://github.com/o/r");
  assert.equal(data.filename, "bitacora_de_propts.md");
  assert.equal(calls[0].url, "/api/artifacts/prompt_log?repo_url=https%3A%2F%2Fgithub.com%2Fo%2Fr");
});
