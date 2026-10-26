import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TOKENS = readFileSync(join(SRC, "styles/tokens.css"), "utf8");

/** Todas las declaraciones `--nombre: valor;` de tokens.css, con los var() ya resueltos. */
function declarations(): Map<string, string> {
  const raw = new Map<string, string>();
  for (const m of TOKENS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    raw.set(m[1], m[2].trim());
  }
  return raw;
}

const RAW = declarations();

function resolve(name: string): string {
  let value = RAW.get(name);
  assert.ok(value, `token no definido: ${name}`);
  while (value.startsWith("var(")) {
    const next = value.slice(4, -1).trim();
    value = RAW.get(next);
    assert.ok(value, `token no definido: ${next} (usado por ${name})`);
  }
  return value;
}

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Color final de `fg` sobre `bg`: si `fg` es rgba(), se compone con su transparencia sobre el fondo. */
function onBackground(fg: string, bg: string): string {
  const m = fg.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) return fg;
  const alpha = Number(m[4]);
  const under = bg.replace("#", "");
  const mixed = [0, 1, 2].map((i) => {
    const top = Number(m[i + 1]);
    const bottom = parseInt(under.slice(i * 2, i * 2 + 2), 16);
    return Math.round(top * alpha + bottom * (1 - alpha));
  });
  return "#" + mixed.map((c) => c.toString(16).padStart(2, "0")).join("");
}

function contrast(a: string, b: string): number {
  const back = resolve(b);
  const [hi, lo] = [luminance(onBackground(resolve(a), back)), luminance(back)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto (primer token) sobre fondo (segundo): WCAG AA para texto normal, 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ["--color-text", "--color-bg"],
  ["--color-text", "--color-surface"],
  ["--color-text", "--color-surface-muted"],
  ["--color-text", "--color-surface-hover"],
  ["--color-text", "--color-sand-soft"],
  ["--color-text-muted", "--color-bg"],
  ["--color-text-muted", "--color-surface"],
  ["--color-text-muted", "--color-surface-muted"],
  ["--color-text-muted", "--color-surface-hover"],
  ["--color-text-muted", "--color-info-bg"],
  ["--color-heading", "--color-surface"],
  ["--color-heading", "--color-surface-muted"],
  ["--color-heading", "--color-bg"],
  ["--color-link", "--color-surface"],
  ["--color-link", "--color-surface-muted"],
  ["--color-link", "--color-bg"],
  ["--color-link", "--color-info-bg"],
  ["--color-on-primary", "--color-primary"],
  ["--color-on-primary", "--color-primary-hover"],
  ["--color-on-primary-muted", "--color-primary"],
  ["--color-accent-on-primary", "--color-primary"],
  ["--color-info-text", "--color-info-bg"],
  ["--color-info-text", "--color-surface"],
  ["--color-discrepancy-text", "--color-discrepancy-bg"],
  ["--color-discrepancy-text", "--color-discrepancy-bg-soft"],
  ["--color-discrepancy-text", "--color-surface"],
  ["--color-discrepancy-text", "--color-bg"],
  ["--color-alert-text", "--color-alert-bg"],
  ["--color-alert-text", "--color-alert-bg-soft"],
  ["--color-alert-text", "--color-surface"],
  ["--color-alert-text", "--color-bg"],
  ["--color-success-text", "--color-surface"],
  ["--color-success-text", "--color-bg"],
  ["--color-diff-added-text", "--color-diff-added-bg"],
  ["--color-diff-removed-text", "--color-diff-removed-bg"],
  ["--color-late-commit-text", "--color-surface"],
  ["--color-late-commit-text", "--color-surface-muted"],
  ["--color-late-commit-text", "--color-bg"],
  ["--color-milestone-end", "--color-surface"],
  ["--color-tooltip-text", "--color-tooltip-bg"],
  ["--color-tooltip-muted", "--color-tooltip-bg"],
  ["--color-tooltip-accent", "--color-tooltip-bg"],
];

test("todo el texto cumple WCAG AA (4.5:1) sobre los fondos donde se usa", () => {
  for (const [fg, bg] of TEXT_PAIRS) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 4.5, `${fg} sobre ${bg}: ${ratio.toFixed(2)}:1 (mínimo 4.5)`);
  }
});

/** Elementos que no son texto (bordes de controles, foco, marcas): WCAG 1.4.11, 3:1. */
const UI_PAIRS: [string, string][] = [
  ["--color-border-strong", "--color-surface"],
  ["--color-focus", "--color-surface"],
  ["--color-focus", "--color-bg"],
  ["--color-focus-on-primary", "--color-primary"],
  ["--color-late-commit", "--color-surface"],
  ["--color-milestone-start", "--color-surface"],
  ["--color-milestone-end", "--color-surface"],
  ["--color-commit-hover", "--color-surface"],
];

test("bordes de controles, foco y marcas tienen al menos 3:1", () => {
  for (const [fg, bg] of UI_PAIRS) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= 3, `${fg} sobre ${bg}: ${ratio.toFixed(2)}:1 (mínimo 3)`);
  }
});

test("la escala del calendario va de claro a oscuro y la celda vacía se distingue de la superficie", () => {
  const lum = [0, 1, 2, 3, 4].map((i) => luminance(resolve(`--color-activity-${i}`)));
  for (let i = 1; i < lum.length; i++) assert.ok(lum[i] < lum[i - 1], `activity-${i} debe ser más oscuro que activity-${i - 1}`);
  assert.ok(contrast("--color-activity-0", "--color-surface") >= 1.15, "activity-0 se confunde con la superficie");
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "assets" ? [] : sourceFiles(path);
    return /\.(css|ts|tsx)$/.test(e.name) ? [path] : [];
  });
}

const FILES = sourceFiles(SRC).filter((f) => !f.endsWith("styles/tokens.css"));

test("no queda ningún color literal fuera de tokens.css", () => {
  const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  const offenders = FILES.filter((f) => readFileSync(f, "utf8").split("\n").some((l) => literal.test(l.replace(/&#\d+;/g, ""))));
  assert.deepEqual(offenders, []);
});

test("los componentes usan solo tokens semánticos (--color-*), no la paleta base", () => {
  const offenders = FILES.filter((f) => /var\(--ocean-/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("todos los tokens definidos se usan y todos los usados existen", () => {
  const all = FILES.map((f) => readFileSync(f, "utf8")).join("\n") + "\n" + TOKENS.replace(/--[\w-]+:/g, "");
  const unused = [...RAW.keys()].filter((name) => !all.includes(`var(${name})`));
  assert.deepEqual(unused, [], "tokens sin uso");
  const used = new Set([...all.matchAll(/var\((--color-[\w-]+)\)/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !RAW.has(name));
  assert.deepEqual(missing, [], "tokens usados pero no definidos");
});

test("los tokens semánticos viven en un único bloque, listo para sumar un tema oscuro", () => {
  const blocks = [...TOKENS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const withColor = blocks.filter((b) => /--color-/.test(b[2]));
  assert.equal(withColor.length, 1, "hay más de un bloque con --color-*");
  assert.match(withColor[0][1], /\[data-theme="light"\]/);
  assert.ok(RAW.has("--color-focus") && RAW.has("--color-bg"));
});

test("los diffs tienen tokens propios, separados de los de alerta y éxito", () => {
  for (const name of ["added", "removed"]) {
    for (const part of ["bg", "text", "border"]) assert.ok(RAW.has(`--color-diff-${name}-${part}`));
  }
});
