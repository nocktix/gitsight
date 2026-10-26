/** Proveedor de IA elegido por el evaluador, recordado en localStorage (como las fechas de la tarea). */

export type ProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "deepseek"
  | "ollama"
  | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  /** Dirección que rellena el preset; "" = la escribe el evaluador ("Otro"). */
  baseUrl: string;
  /** Ejemplo que se muestra en el campo de modelo. */
  modelPlaceholder: string;
  /** Página donde se crea la API key; null si no aplica. */
  keysUrl: string | null;
  keyRequired: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", modelPlaceholder: "nvidia/nemotron-3-ultra-550b-a55b:free", keysUrl: "https://openrouter.ai/keys", keyRequired: true },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelPlaceholder: "gpt-4o-mini", keysUrl: "https://platform.openai.com/api-keys", keyRequired: true },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelPlaceholder: "claude-sonnet-4-5", keysUrl: "https://platform.claude.com/settings/keys", keyRequired: true },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelPlaceholder: "gemini-2.5-flash", keysUrl: "https://aistudio.google.com/apikey", keyRequired: true },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", modelPlaceholder: "llama-3.3-70b-versatile", keysUrl: "https://console.groq.com/keys", keyRequired: true },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", modelPlaceholder: "deepseek-chat", keysUrl: "https://platform.deepseek.com/api_keys", keyRequired: true },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", modelPlaceholder: "llama3.1", keysUrl: null, keyRequired: false },
  { id: "custom", label: "Otro (compatible con OpenAI)", baseUrl: "", modelPlaceholder: "nombre-del-modelo", keysUrl: null, keyRequired: false },
];

export function presetOf(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Lo que se recuerda de cada proveedor, para no volver a escribirlo al cambiar de uno a otro. */
export interface ProviderSettings {
  /** "" = Automático (solo OpenRouter). */
  model: string;
  /** Solo se usa con "Otro". */
  baseUrl: string;
  apiKey: string;
}

export interface LlmStore {
  /** Proveedor en uso; null si el evaluador todavía no configuró ninguno. */
  active: ProviderId | null;
  providers: Partial<Record<ProviderId, ProviderSettings>>;
}

const KEY = "tid.llm";
export const EMPTY_STORE: LlmStore = { active: null, providers: {} };
export const EMPTY_SETTINGS: ProviderSettings = { model: "", baseUrl: "", apiKey: "" };

function isProviderId(value: unknown): value is ProviderId {
  return PROVIDERS.some((p) => p.id === value);
}

/** Lo guardado, o vacío si no hay nada, está dañado o localStorage no está disponible. */
export function readLlmStore(): LlmStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_STORE;
    const data = JSON.parse(raw) as Partial<LlmStore>;
    const providers: LlmStore["providers"] = {};
    for (const preset of PROVIDERS) {
      const s = data.providers?.[preset.id];
      if (s && typeof s === "object") {
        providers[preset.id] = {
          model: typeof s.model === "string" ? s.model : "",
          baseUrl: typeof s.baseUrl === "string" ? s.baseUrl : "",
          apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
        };
      }
    }
    return { active: isProviderId(data.active) ? data.active : null, providers };
  } catch {
    return EMPTY_STORE;
  }
}

export function writeLlmStore(store: LlmStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // sin localStorage la configuración solo dura la sesión
  }
}

export function settingsOf(store: LlmStore, id: ProviderId): ProviderSettings {
  return store.providers[id] ?? EMPTY_SETTINGS;
}

/** ¿Alcanza esta configuración para llamar al proveedor? */
export function isComplete(id: ProviderId, s: ProviderSettings): boolean {
  const preset = presetOf(id);
  if (preset.keyRequired && !s.apiKey.trim()) return false;
  if (id === "custom" && !s.baseUrl.trim()) return false;
  // OpenRouter sin modelo = Automático; en los demás el modelo es obligatorio.
  if (id !== "openrouter" && !s.model.trim()) return false;
  return true;
}

export interface LlmConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** Configuración en uso, o null si no hay proveedor elegido o falta algo. */
export function activeConfig(store: LlmStore): LlmConfig | null {
  if (!store.active) return null;
  const s = settingsOf(store, store.active);
  if (!isComplete(store.active, s)) return null;
  return { provider: store.active, model: s.model.trim(), baseUrl: s.baseUrl.trim(), apiKey: s.apiKey.trim() };
}

/** Campos de una petición: `llm` va en el body y la key, aparte, en el header X-LLM-Api-Key. */
export interface LlmRequestFields {
  llm: { provider: ProviderId; model?: string; base_url?: string };
  apiKey: string;
}

export function llmRequest(config: LlmConfig): LlmRequestFields {
  return {
    llm: {
      provider: config.provider,
      ...(config.model ? { model: config.model } : {}),
      ...(config.provider === "custom" && config.baseUrl ? { base_url: config.baseUrl } : {}),
    },
    apiKey: config.apiKey,
  };
}

export const API_KEY_HEADER = "X-LLM-Api-Key";

/** Headers de una petición al LLM: la key solo viaja si hay una. */
export function llmHeaders(apiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", ...(apiKey ? { [API_KEY_HEADER]: apiKey } : {}) };
}

/** "••••1234": solo los últimos 4 caracteres de una key guardada. */
export function maskKey(apiKey: string): string {
  const tail = apiKey.length > 8 ? apiKey.slice(-4) : "";
  return `••••••••${tail}`;
}

/** Texto corto del proveedor y modelo en uso, para mostrarlo en pantalla. */
export function describeConfig(store: LlmStore): string {
  if (!store.active) return "Sin configurar";
  const model = settingsOf(store, store.active).model.trim();
  return `${presetOf(store.active).label} · ${model || "Automático"}`;
}
