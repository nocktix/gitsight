import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_STORE, modelStatus } from "../src/utils/llmConfig.ts";
import type { LlmStore } from "../src/utils/llmConfig.ts";
import { welcomeSteps } from "../src/utils/welcomeSteps.ts";

const CONFIGURED: LlmStore = {
  active: "openai",
  providers: { openai: { model: "gpt-4o", baseUrl: "", apiKey: "sk-secreta-1234567890" } },
};

test("sin modelo y sin lote: paso 1 actual, paso 2 aviso con ⚠ y 'Configura el modelo de IA', paso 3 neutro", () => {
  const [one, two, three] = welcomeSteps(modelStatus(EMPTY_STORE), false);
  assert.deepEqual([one.tone, one.icon, one.action], ["current", null, false]);
  assert.deepEqual([two.tone, two.icon, two.action], ["warning", "warning", true]);
  assert.equal(two.text, "Configura el modelo de IA");
  assert.deepEqual([three.tone, three.icon, three.action], ["upcoming", null, false]);
});

test("con modelo: paso 2 de éxito con ✓ y '<proveedor> · <modelo>', sin la clave", () => {
  const two = welcomeSteps(modelStatus(CONFIGURED), false)[1];
  assert.deepEqual([two.tone, two.icon, two.action], ["success", "check", true]);
  assert.equal(two.text, "OpenAI · gpt-4o");
  assert.ok(!two.text.includes("sk-"));
});

test("el estado del modelo cambia el ícono y el texto, no solo el tono", () => {
  const sin = welcomeSteps(modelStatus(EMPTY_STORE), false)[1];
  const con = welcomeSteps(modelStatus(CONFIGURED), false)[1];
  assert.notEqual(sin.icon, con.icon);
  assert.notEqual(sin.text, con.text);
});

test("con un lote escaneado: paso 1 completado (✓) y paso 3 actual; el paso 2 conserva su estado", () => {
  for (const store of [EMPTY_STORE, CONFIGURED]) {
    const before = welcomeSteps(modelStatus(store), false);
    const after = welcomeSteps(modelStatus(store), true);
    assert.deepEqual([after[0].tone, after[0].icon], ["done", "check"]);
    assert.deepEqual([after[2].tone, after[2].icon], ["current", null]);
    assert.deepEqual(after[1], before[1]);
  }
});

test("solo el paso del modelo es un botón", () => {
  assert.deepEqual(welcomeSteps(modelStatus(EMPTY_STORE), true).map((s) => s.action), [false, true, false]);
});
