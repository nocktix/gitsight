"""Capa de proveedores de LLM: una interfaz única, `generate(messages, config)`.

Dos implementaciones: el protocolo "chat completions" de OpenAI (con `base_url` configurable, sirve
para OpenRouter, OpenAI, Gemini, Groq, DeepSeek, Mistral, Ollama y cualquier endpoint compatible)
y la Messages API nativa de Anthropic. La API key viaja solo en memoria: nunca se escribe en
disco ni en logs, y los errores se construyen sin ella (ver llm_errors).
"""

import os
from dataclasses import dataclass, field, replace
from urllib.parse import urlparse

import httpx

from app import llm_errors
from app.llm_errors import LLMError

DEFAULT_TIMEOUT = 120.0
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_MAX_TOKENS = 8192


@dataclass(frozen=True)
class ProviderPreset:
    protocol: str  # "openai" | "anthropic"
    base_url: str | None  # None: el usuario debe indicarla ("custom")
    key_required: bool = True


PRESETS: dict[str, ProviderPreset] = {
    "openrouter": ProviderPreset("openai", "https://openrouter.ai/api/v1"),
    "openai": ProviderPreset("openai", "https://api.openai.com/v1"),
    "anthropic": ProviderPreset("anthropic", "https://api.anthropic.com/v1"),
    "gemini": ProviderPreset("openai", "https://generativelanguage.googleapis.com/v1beta/openai"),
    "groq": ProviderPreset("openai", "https://api.groq.com/openai/v1"),
    "deepseek": ProviderPreset("openai", "https://api.deepseek.com"),
    "mistral": ProviderPreset("openai", "https://api.mistral.ai/v1"),
    "ollama": ProviderPreset("openai", "http://localhost:11434/v1", key_required=False),
    "custom": ProviderPreset("openai", None, key_required=False),
}


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    model: str | None  # None: modo Automático (solo OpenRouter, cadena de modelos gratuitos)
    base_url: str
    api_key: str | None = field(default=None, repr=False)

    def with_model(self, model: str | None) -> "LLMConfig":
        return replace(self, model=model)


@dataclass
class ProviderResult:
    text: str
    model: str
    tokens_prompt: int = 0
    tokens_completion: int = 0


def resolve_config(
    provider: str | None, model: str | None, base_url: str | None, api_key: str | None
) -> LLMConfig:
    """Arma la configuración de una petición. Sin `provider` usa el respaldo del .env
    (OPENROUTER_API_KEY, solo para desarrollo); sin .env lanza `llm_not_configured`."""
    env_key = os.getenv("OPENROUTER_API_KEY") or None
    if not provider:
        if not env_key:
            raise LLMError(
                llm_errors.NOT_CONFIGURED,
                "No hay un proveedor de IA configurado. Abre la configuración (ícono de "
                "engranaje) y elige un proveedor, un modelo y tu API key.",
            )
        return LLMConfig("openrouter", None, PRESETS["openrouter"].base_url, env_key)

    preset = PRESETS.get(provider)
    if preset is None:
        raise LLMError(llm_errors.NOT_CONFIGURED, f"Proveedor desconocido: {provider!r}.")

    url = (base_url or "").strip() or preset.base_url
    if not url:
        raise LLMError(llm_errors.NOT_CONFIGURED, "Falta la dirección (base URL) del proveedor.")
    if urlparse(url).scheme not in ("http", "https") or not urlparse(url).netloc:
        raise LLMError(
            llm_errors.NOT_CONFIGURED, "La dirección del proveedor debe empezar con http:// o https://."
        )

    key = (api_key or "").strip() or (env_key if provider == "openrouter" else None)
    if preset.key_required and not key:
        raise LLMError(llm_errors.NOT_CONFIGURED, "Falta la API key del proveedor.")

    model = (model or "").strip() or None
    if model is None and provider != "openrouter":
        raise LLMError(llm_errors.NOT_CONFIGURED, "Falta indicar el modelo.")
    return LLMConfig(provider, model, url.rstrip("/"), key)


def _http_error(exc: Exception, config: LLMConfig) -> LLMError:
    if isinstance(exc, httpx.TimeoutException):
        return LLMError(llm_errors.TIMEOUT, model_attempted=config.model)
    return LLMError(
        llm_errors.UNREACHABLE, model_attempted=config.model, detail=type(exc).__name__
    )


def _post(url: str, headers: dict, body: dict, config: LLMConfig, timeout: float) -> dict:
    try:
        response = httpx.post(url, headers=headers, json=body, timeout=timeout)
    except httpx.HTTPError as exc:
        raise _http_error(exc, config) from None  # sin encadenar: el mensaje httpx puede traer la URL
    if response.status_code >= 400:
        raise llm_errors.from_http_status(
            response.status_code, response.text, model=config.model, api_key=config.api_key
        )
    try:
        return response.json()
    except ValueError:
        raise LLMError(
            llm_errors.PROVIDER_ERROR,
            "El proveedor respondió algo que no es JSON; revisa la dirección (base URL).",
            model_attempted=config.model,
        ) from None


def _generate_openai(
    messages: list[dict], config: LLMConfig, json_mode: bool, max_tokens: int | None, timeout: float
) -> ProviderResult:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    if config.provider == "openrouter":
        headers["HTTP-Referer"] = "http://localhost"
        headers["X-Title"] = "GitSight"
    body: dict = {"model": config.model, "messages": messages}
    if max_tokens:
        body["max_tokens"] = max_tokens
    url = f"{config.base_url}/chat/completions"

    if json_mode:
        try:
            data = _post(url, headers, {**body, "response_format": {"type": "json_object"}}, config, timeout)
        except LLMError as exc:
            # No todos los endpoints compatibles aceptan response_format: se reintenta sin él.
            # Los errores de key, crédito, modelo o red no se reintentan.
            if exc.code != llm_errors.PROVIDER_ERROR:
                raise
            data = _post(url, headers, body, config, timeout)
    else:
        data = _post(url, headers, body, config, timeout)

    choices = data.get("choices") or []
    content = (choices[0].get("message") or {}).get("content") if choices else None
    if not content:
        raise LLMError(
            llm_errors.PROVIDER_ERROR,
            "El modelo no devolvió ninguna respuesta.",
            model_attempted=config.model,
        )
    usage = data.get("usage") or {}
    return ProviderResult(
        text=content,
        model=data.get("model") or config.model,
        tokens_prompt=usage.get("prompt_tokens") or 0,
        tokens_completion=usage.get("completion_tokens") or 0,
    )


def _generate_anthropic(
    messages: list[dict], config: LLMConfig, max_tokens: int | None, timeout: float
) -> ProviderResult:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    body: dict = {
        "model": config.model,
        "max_tokens": max_tokens or ANTHROPIC_MAX_TOKENS,
        "messages": [m for m in messages if m["role"] != "system"],
    }
    if system:
        body["system"] = system
    headers = {
        "x-api-key": config.api_key or "",
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }
    data = _post(f"{config.base_url}/messages", headers, body, config, timeout)
    text = "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")
    if not text:
        raise LLMError(
            llm_errors.PROVIDER_ERROR,
            "El modelo no devolvió ninguna respuesta.",
            model_attempted=config.model,
        )
    usage = data.get("usage") or {}
    return ProviderResult(
        text=text,
        model=data.get("model") or config.model,
        tokens_prompt=usage.get("input_tokens") or 0,
        tokens_completion=usage.get("output_tokens") or 0,
    )


def generate(
    messages: list[dict],
    config: LLMConfig,
    *,
    json_mode: bool = False,
    max_tokens: int | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> ProviderResult:
    """Una llamada al modelo `config.model`. `messages` usa roles system/user/assistant.
    `json_mode` pide respuesta JSON cuando el proveedor lo permite (Anthropic no tiene ese modo:
    ahí se confía en el prompt y en el reintento por formato)."""
    if PRESETS[config.provider].protocol == "anthropic":
        return _generate_anthropic(messages, config, max_tokens, timeout)
    return _generate_openai(messages, config, json_mode, max_tokens, timeout)
