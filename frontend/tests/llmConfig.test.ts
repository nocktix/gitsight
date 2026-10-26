import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAnalysis } from "../src/api/analyzeClient.ts";
import { generateSummary } from "../src/api/commitSummaryClient.ts";
import { BackendError } from "../src/api/http.ts";
import { testLlm } from "../src/api/llmClient.ts";
import {
  EMPTY_STORE,
  PROVIDERS,
  activeConfig,
  describeConfig,
  llmRequest,
  maskKey,
  readLlmStore,
  writeLlmStore,
} from "../src/utils/llmConfig.ts";
import type { LlmStore } from "../src/utils/llmConfig.ts";
import { friendlyLlmError, isLlmErrorCode, isRetryable } from "../src/utils/llmErrors.ts";
import { fakeFetch, fakeLocalStorage } from "./fakeBackend.ts";

const URL_A = "https://github.com/UAICL/tarea02-ana";
const HASH = "a".repeat(40);
const KEY = "sk-secreta-1234567890";
const REQUEST = { repo_url: URL_A, include_prompt_log: true, include_authorship: true };

const OPENAI: LlmStore = {
  active: "openai",
  providers: { openai: { model: "gpt-4o-mini", baseUrl: "", apiKey: KEY } },
};

test("los presets rellenan la dirección y solo Ollama y Otro no exigen key", () => {
  const byId = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
  assert.equal(byId.groq.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(byId.custom.baseUrl, "");
  assert.deepEqual(
    PROVIDERS.filter((p) => !p.keyRequired).map((p) => p.id),
    ["ollama", "custom"],
  );
});

test("la configuración se guarda y se lee de localStorage", () => {
  fakeLocalStorage({});
  assert.deepEqual(readLlmStore(), EMPTY_STORE);
  writeLlmStore(OPENAI);
  assert.deepEqual(readLlmStore(), OPENAI);
});

test("sin localStorage disponible o con datos dañados no se rompe", () => {
  const broken = () => {
    throw new Error("bloqueado");
  };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: broken, setItem: broken, removeItem: broken };
  assert.deepEqual(readLlmStore(), EMPTY_STORE);
  assert.doesNotThrow(() => writeLlmStore(OPENAI));
  fakeLocalStorage({});
  (globalThis as { localStorage: Storage }).localStorage.setItem("tid.llm", "{no es json");
  assert.deepEqual(readLlmStore(), EMPTY_STORE);
});

test("cada proveedor recuerda lo suyo al cambiar de uno a otro", () => {
  const store: LlmStore = {
    active: "groq",
    providers: { ...OPENAI.providers, groq: { model: "llama", baseUrl: "", apiKey: "gsk-1" } },
  };
  fakeLocalStorage({});
  writeLlmStore(store);
  assert.equal(readLlmStore().providers.openai?.apiKey, KEY);
  assert.equal(activeConfig(store)?.apiKey, "gsk-1");
});

test("la configuración está completa según el proveedor", () => {
  assert.equal(activeConfig(EMPTY_STORE), null);
  assert.ok(activeConfig(OPENAI));
  // falta la key
  assert.equal(activeConfig({ active: "openai", providers: { openai: { ...OPENAI.providers.openai!, apiKey: "" } } }), null);
  // OpenRouter sin modelo = Automático
  assert.ok(activeConfig({ active: "openrouter", providers: { openrouter: { model: "", baseUrl: "", apiKey: "k" } } }));
  // Ollama sin key pero con modelo
  assert.ok(activeConfig({ active: "ollama", providers: { ollama: { model: "llama3.1", baseUrl: "", apiKey: "" } } }));
  assert.equal(activeConfig({ active: "ollama", providers: {} }), null);
  // Otro exige dirección
  assert.equal(activeConfig({ active: "custom", providers: { custom: { model: "m", baseUrl: "", apiKey: "" } } }), null);
});

test("la key se enmascara mostrando solo los últimos 4 caracteres", () => {
  assert.equal(maskKey(KEY), "••••••••7890");
  assert.ok(!maskKey(KEY).includes("secreta"));
  assert.equal(maskKey("corta"), "••••••••");
});

test("describeConfig nombra proveedor y modelo (Automático si no hay)", () => {
  assert.equal(describeConfig(EMPTY_STORE), "Sin configurar");
  assert.equal(describeConfig(OPENAI), "OpenAI · gpt-4o-mini");
  assert.equal(describeConfig({ active: "openrouter", providers: {} }), "OpenRouter · Automático");
});

test("llmRequest separa la key del body y solo manda base_url con Otro", () => {
  const { llm, apiKey } = llmRequest(activeConfig(OPENAI)!);
  assert.deepEqual(llm, { provider: "openai", model: "gpt-4o-mini" });
  assert.equal(apiKey, KEY);
  const custom = llmRequest({ provider: "custom", model: "m", baseUrl: "http://x/v1", apiKey: "" });
  assert.deepEqual(custom.llm, { provider: "custom", model: "m", base_url: "http://x/v1" });
  assert.deepEqual(llmRequest({ provider: "openrouter", model: "", baseUrl: "", apiKey: "k" }).llm, { provider: "openrouter" });
});

test("el análisis manda llm en el body y la key solo en el header", async () => {
  const calls = fakeFetch(() => ({ body: {} }));
  const { llm, apiKey } = llmRequest(activeConfig(OPENAI)!);
  await fetchAnalysis({ ...REQUEST, llm }, apiKey);
  assert.equal(calls[0].headers["X-LLM-Api-Key"], KEY);
  assert.deepEqual((calls[0].body as { llm: unknown }).llm, { provider: "openai", model: "gpt-4o-mini" });
  assert.ok(!JSON.stringify(calls[0].body).includes(KEY));
});

test("sin key (Ollama) no viaja el header", async () => {
  const calls = fakeFetch(() => ({ body: {} }));
  await generateSummary(URL_A, HASH, false, { provider: "ollama", model: "llama3.1" }, "");
  assert.equal("X-LLM-Api-Key" in calls[0].headers, false);
  assert.deepEqual(calls[0].body, { repo_url: URL_A, regenerate: false, llm: { provider: "ollama", model: "llama3.1" } });
});

test("probar conexión llama a /api/llm/test con la key en el header", async () => {
  const calls = fakeFetch(() => ({ body: { ok: true, model: "gpt", latency_ms: 12 } }));
  const result = await testLlm(activeConfig(OPENAI)!);
  assert.equal(result.latency_ms, 12);
  assert.equal(calls[0].url, "/api/llm/test");
  assert.equal(calls[0].headers["X-LLM-Api-Key"], KEY);
  assert.ok(!JSON.stringify(calls[0].body).includes(KEY));
});

test("cada error tipificado del backend es un error del LLM con su código y su modelo", async () => {
  for (const code of ["invalid_api_key", "no_credit_or_rate_limit", "model_not_found", "provider_unreachable", "timeout", "provider_error", "llm_not_configured", "llm_invalid_response_format"]) {
    fakeFetch(() => ({ status: 502, body: { error: code, message: "x", model_attempted: "m" } }));
    const err = (await testLlm(activeConfig(OPENAI)!).catch((e: unknown) => e)) as BackendError;
    assert.ok(err instanceof BackendError);
    assert.equal(err.isLlmError, true, code);
    assert.equal(err.code, code);
    assert.equal(err.modelAttempted, "m");
  }
  fakeFetch(() => ({ status: 400, body: { detail: "mal" } }));
  const other = (await fetchAnalysis(REQUEST, "").catch((e: unknown) => e)) as BackendError;
  assert.equal(other.isLlmError, false);
});

test("cada caso se explica por separado en lenguaje simple", () => {
  const codes = ["llm_not_configured", "invalid_api_key", "no_credit_or_rate_limit", "model_not_found", "provider_unreachable", "timeout", "provider_error", "llm_invalid_response_format"];
  const texts = codes.map((c) => friendlyLlmError(c, "gpt-x", "fallback"));
  assert.equal(new Set(texts).size, codes.length);
  assert.ok(texts.every((t) => t !== "fallback" && !/HTTP|401|JSON|token/i.test(t)));
  assert.ok(friendlyLlmError("model_not_found", "gpt-x", "").includes("gpt-x"));
  assert.equal(friendlyLlmError("otro", null, "fallback"), "fallback");
});

test("solo se ofrece reintentar cuando el error puede ser pasajero", () => {
  assert.equal(isRetryable("timeout"), true);
  assert.equal(isRetryable("provider_error"), true);
  assert.equal(isRetryable("invalid_api_key"), false);
  assert.equal(isRetryable("no_credit_or_rate_limit"), false);
  assert.equal(isLlmErrorCode("invalid_api_key"), true);
  assert.equal(isLlmErrorCode("repo_not_found"), false);
  assert.equal(isLlmErrorCode(null), false);
});
