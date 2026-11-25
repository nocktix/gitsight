import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_STORE, modelStatus } from "../src/utils/llmConfig.ts";
import type { LlmStore } from "../src/utils/llmConfig.ts";

const CONFIGURED: LlmStore = {
  active: "openai",
  providers: { openai: { model: "gpt-4o", baseUrl: "", apiKey: "sk-secreta-1234567890" } },
};

test("sin proveedor la línea dice 'sin configurar'", () => {
  assert.deepEqual(modelStatus(EMPTY_STORE), { configured: false, label: "sin configurar" });
});

test("con proveedor pero sin clave sigue sin configurar (el análisis no podría partir)", () => {
  const sinClave: LlmStore = {
    active: "openai",
    providers: { openai: { model: "gpt-4o", baseUrl: "", apiKey: "" } },
  };
  assert.equal(modelStatus(sinClave).configured, false);
  assert.equal(modelStatus(sinClave).label, "sin configurar");
});

test("configurado muestra proveedor y modelo, sin la clave", () => {
  const status = modelStatus(CONFIGURED);
  assert.equal(status.configured, true);
  assert.equal(status.label, "OpenAI · gpt-4o");
  assert.ok(!status.label.includes("sk-"));
});
