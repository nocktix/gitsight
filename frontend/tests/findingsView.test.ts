import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding, FindingType } from "../src/types/analyze.ts";
import {
  countByType,
  defaultOpenCriteria,
  emptyFilterText,
  toggleType,
  visibleFindings,
} from "../src/utils/findingsView.ts";

const f = (type: FindingType, criterion: string | null): Finding => ({
  type,
  criterion,
  title: `${type}-${criterion}`,
  description: "",
});

const FINDINGS = [
  f("alert", "C1"),
  f("info", "C1"),
  f("discrepancy", "C2"),
  f("info", "C3"),
  f("info", null),
];
const none = new Set<FindingType>();

test("cuenta los hallazgos por tipo", () => {
  assert.deepEqual(countByType(FINDINGS), { alert: 1, discrepancy: 1, info: 3 });
});

test("sin filtro se ve todo, con criterios en orden y los generales aparte", () => {
  const v = visibleFindings(FINDINGS, none);
  assert.equal(v.total, 5);
  assert.deepEqual(v.criteria.map(([c]) => c), ["C1", "C2", "C3"]);
  assert.equal(v.general.length, 1);
});

test("al filtrar, los criterios que se quedan sin hallazgos se ocultan", () => {
  const v = visibleFindings(FINDINGS, new Set<FindingType>(["alert"]));
  assert.deepEqual(v.criteria.map(([c]) => c), ["C1"]);
  assert.deepEqual(v.criteria[0][1].map((x) => x.type), ["alert"]);
  assert.equal(v.general.length, 0);
  assert.equal(v.total, 1);
});

test("se pueden combinar tipos", () => {
  const v = visibleFindings(FINDINGS, new Set<FindingType>(["discrepancy", "alert"]));
  assert.deepEqual(v.criteria.map(([c]) => c), ["C1", "C2"]);
});

test("un filtro que deja todo vacío da total 0 y un texto que lo explica", () => {
  const onlyInfo = [f("info", "C1")];
  const filter = new Set<FindingType>(["alert", "discrepancy"]);
  const v = visibleFindings(onlyInfo, filter);
  assert.equal(v.total, 0);
  assert.deepEqual(v.criteria, []);
  assert.equal(
    emptyFilterText(filter),
    "Este análisis no tiene alertas ni discrepancias. Quita el filtro para ver todos los hallazgos.",
  );
});

test("se abren por defecto solo los criterios con alertas", () => {
  const { criteria } = visibleFindings(FINDINGS, none);
  assert.deepEqual([...defaultOpenCriteria(criteria)], ["C1"]);
});

test("toggleType activa y desactiva sin mutar el filtro anterior; vacío vuelve a «todos»", () => {
  const a = toggleType(none, "alert");
  assert.deepEqual([...a], ["alert"]);
  assert.equal(none.size, 0);
  const b = toggleType(a, "alert");
  assert.equal(b.size, 0);
  assert.equal(visibleFindings(FINDINGS, b).total, 5);
});
