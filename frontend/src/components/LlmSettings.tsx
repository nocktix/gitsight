import { useEffect, useState } from "react";
import { BackendError } from "../api/http";
import { testLlm } from "../api/llmClient";
import type { LlmTestResult } from "../api/llmClient";
import { fetchModels } from "../api/modelsClient";
import type { ModelOption } from "../api/modelsClient";
import { useLlmConfig } from "../context/useLlmConfig";
import { friendlyLlmError } from "../utils/llmErrors";
import {
  PROVIDERS,
  isComplete,
  maskKey,
  presetOf,
  settingsOf,
} from "../utils/llmConfig";
import type { LlmStore, ProviderId, ProviderSettings } from "../utils/llmConfig";
import "./LlmSettings.css";

const AUTOMATIC = "";
const OTHER = "__other__";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; result: LlmTestResult }
  | { status: "error"; message: string };

/** Modal "Modelo de IA": proveedor, modelo y API key del evaluador. Nada sale de aquí sin Guardar. */
export default function LlmSettings() {
  const { store, save, closeSettings } = useLlmConfig();
  const [draft, setDraft] = useState<LlmStore>(store);
  const [catalog, setCatalog] = useState<ModelOption[]>([]);
  const [changingKey, setChangingKey] = useState(false);
  const [otherModel, setOtherModel] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const provider: ProviderId = draft.active ?? "openrouter";
  const preset = presetOf(provider);
  const current = settingsOf(draft, provider);
  const complete = isComplete(provider, current);
  // Enmascarada solo una key ya guardada; lo que se está escribiendo se ve como contraseña.
  const savedKey = settingsOf(store, provider).apiKey;
  const hasSavedKey = savedKey !== "" && current.apiKey === savedKey && !changingKey;
  const isOpenRouter = provider === "openrouter";
  const knownModel = catalog.some((m) => m.id === current.model);
  const showModelInput = !isOpenRouter || otherModel || (current.model !== AUTOMATIC && !knownModel);

  // Sugerencias de OpenRouter: el catálogo del backend (models_config.json).
  useEffect(() => {
    const controller = new AbortController();
    fetchModels(controller.signal)
      .then((c) => setCatalog(c.models))
      .catch(() => {
        // sin catálogo OpenRouter solo ofrece Automático y escribir el modelo
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSettings();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSettings]);

  function patch(changes: Partial<ProviderSettings>) {
    setTest({ status: "idle" });
    setDraft((d) => ({
      ...d,
      active: provider,
      providers: { ...d.providers, [provider]: { ...settingsOf(d, provider), ...changes } },
    }));
  }

  function chooseProvider(id: ProviderId) {
    setTest({ status: "idle" });
    setChangingKey(false);
    setOtherModel(false);
    setDraft((d) => ({ ...d, active: id }));
  }

  function deleteKey() {
    // Se borra de inmediato (también lo guardado): es lo que espera quien pulsa "Borrar".
    const next: LlmStore = {
      ...draft,
      providers: { ...draft.providers, [provider]: { ...current, apiKey: "" } },
    };
    setDraft(next);
    save({
      ...store,
      providers: { ...store.providers, [provider]: { ...settingsOf(store, provider), apiKey: "" } },
    });
    setChangingKey(false);
    setTest({ status: "idle" });
  }

  function runTest() {
    setTest({ status: "running" });
    testLlm({
      provider,
      model: current.model.trim(),
      baseUrl: current.baseUrl.trim(),
      apiKey: current.apiKey.trim(),
    })
      .then((result) => setTest({ status: "ok", result }))
      .catch((err: Error) =>
        setTest({
          status: "error",
          message:
            err instanceof BackendError
              ? friendlyLlmError(err.code, err.modelAttempted, err.message)
              : err.message,
        }),
      );
  }

  return (
    <div className="llm-settings__backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSettings()}>
      <div aria-labelledby="llm-settings-title" aria-modal="true" className="llm-settings" role="dialog">
        <h2 className="llm-settings__title" id="llm-settings-title">
          Modelo de IA
        </h2>
        <p className="llm-settings__hint">
          El análisis con IA usa tu propio proveedor. Tu clave se guarda solo en este navegador y
          el servidor no la almacena.
        </p>

        <label className="llm-settings__field">
          <span>Proveedor</span>
          <select onChange={(e) => chooseProvider(e.target.value as ProviderId)} value={provider}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {provider === "custom" && (
          <label className="llm-settings__field">
            <span>Dirección del servicio (base URL)</span>
            <input
              onChange={(e) => patch({ baseUrl: e.target.value })}
              placeholder="https://mi-servidor.com/v1"
              type="url"
              value={current.baseUrl}
            />
          </label>
        )}

        <label className="llm-settings__field">
          <span>Modelo</span>
          {isOpenRouter && (
            <select
              onChange={(e) => {
                const v = e.target.value;
                setOtherModel(v === OTHER);
                patch({ model: v === OTHER ? "" : v });
              }}
              value={showModelInput ? OTHER : current.model}
            >
              <option value={AUTOMATIC}>Automático (modelos gratuitos con respaldo)</option>
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.free ? " (gratis)" : ""}
                </option>
              ))}
              <option value={OTHER}>Otro modelo…</option>
            </select>
          )}
          {showModelInput && (
            <input
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={preset.modelPlaceholder}
              type="text"
              value={current.model}
            />
          )}
        </label>

        <div className="llm-settings__field">
          <span>
            API key{!preset.keyRequired && " (opcional)"}
          </span>
          {hasSavedKey ? (
            <div className="llm-settings__key">
              <code aria-label="API key guardada">{maskKey(current.apiKey)}</code>
              <button
                onClick={() => {
                  setChangingKey(true);
                  patch({ apiKey: "" });
                }}
                type="button"
              >
                Cambiar
              </button>
              <button onClick={deleteKey} type="button">
                Borrar
              </button>
            </div>
          ) : (
            <input
              autoComplete="off"
              onChange={(e) => patch({ apiKey: e.target.value })}
              placeholder="Pega aquí tu clave"
              spellCheck={false}
              type="password"
              value={current.apiKey}
            />
          )}
          {preset.keysUrl && (
            <a href={preset.keysUrl} rel="noreferrer" target="_blank">
              Crear una clave en {preset.label}
            </a>
          )}
        </div>

        <div className="llm-settings__test">
          <button disabled={!complete || test.status === "running"} onClick={runTest} type="button">
            {test.status === "running" ? "Probando..." : "Probar conexión"}
          </button>
          {test.status === "ok" && (
            <p className="llm-settings__ok" role="status">
              Conexión correcta con {test.result.model} ({test.result.latency_ms} ms).
            </p>
          )}
          {test.status === "error" && (
            <p className="llm-settings__error" role="alert">
              {test.message}
            </p>
          )}
        </div>

        <div className="llm-settings__actions">
          <button onClick={closeSettings} type="button">
            Cancelar
          </button>
          <button
            className="llm-settings__primary"
            disabled={!complete}
            onClick={() => {
              save(draft);
              closeSettings();
            }}
            type="button"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
