"""Errores tipificados del proveedor de LLM.

Cada error lleva un `code` estable (el frontend lo traduce a lenguaje simple) y un mensaje en
español. Ni el mensaje ni el detalle contienen jamás la API key: todo texto del proveedor pasa
por `redact` antes de guardarse en la excepción.
"""

NOT_CONFIGURED = "llm_not_configured"
INVALID_API_KEY = "invalid_api_key"
NO_CREDIT = "no_credit_or_rate_limit"
MODEL_NOT_FOUND = "model_not_found"
UNREACHABLE = "provider_unreachable"
TIMEOUT = "timeout"
PROVIDER_ERROR = "provider_error"

# código -> (status HTTP de la respuesta del backend, mensaje)
_ERRORS: dict[str, tuple[int, str]] = {
    NOT_CONFIGURED: (400, "No hay un proveedor de IA configurado."),
    INVALID_API_KEY: (401, "El proveedor rechazó la API key (inválida, vencida o sin permisos)."),
    NO_CREDIT: (
        402,
        "El proveedor indica que no hay crédito disponible o que se alcanzó el límite de uso.",
    ),
    MODEL_NOT_FOUND: (400, "El proveedor no reconoce el modelo indicado."),
    UNREACHABLE: (502, "No se pudo conectar con el proveedor."),
    TIMEOUT: (504, "El proveedor tardó demasiado en responder."),
    PROVIDER_ERROR: (502, "El proveedor devolvió un error."),
}

_DETAIL_MAX = 300


def redact(text: str, api_key: str | None) -> str:
    """Quita la API key (y cualquier cosa con forma de key) de un texto del proveedor."""
    if api_key:
        text = text.replace(api_key, "***")
    return text


class LLMError(Exception):
    """Falla al hablar con el proveedor de LLM. `detail` es el texto (ya sin la key) que
    devolvió el proveedor, útil para diagnosticar."""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        model_attempted: str | None = None,
        detail: str | None = None,
        api_key: str | None = None,
    ):
        status, default_message = _ERRORS[code]
        super().__init__(message or default_message)
        self.code = code
        self.status = status
        self.message = message or default_message
        self.model_attempted = model_attempted
        self.detail = redact(detail, api_key)[:_DETAIL_MAX] if detail else None


class LLMResponseFormatError(Exception):
    """El LLM no devolvió un JSON con la estructura esperada."""

    def __init__(self, message: str, raw_response: str, model: str | None = None):
        super().__init__(message)
        self.message = message
        self.raw_response = raw_response
        self.model = model  # modelo que respondió con mal formato (lo completa analyze_structured)


_CREDIT_WORDS = ("credit", "quota", "billing", "insufficient", "balance", "rate limit", "rate_limit")
_MODEL_WORDS = ("model", "modelo")
_MODEL_MISSING_WORDS = ("not found", "not_found", "does not exist", "not a valid", "invalid model", "unknown")


def from_http_status(
    status: int, body_text: str, *, model: str | None, api_key: str | None
) -> LLMError:
    """Traduce una respuesta HTTP de error del proveedor al error tipificado."""
    low = body_text.lower()
    if status in (401, 403):
        code = INVALID_API_KEY
    elif status in (402, 429):
        code = NO_CREDIT
    elif status in (400, 404, 422) and "api key" in low and ("invalid" in low or "not valid" in low):
        code = INVALID_API_KEY  # Gemini responde 400 ante una key inválida
    elif any(w in low for w in _CREDIT_WORDS):
        code = NO_CREDIT  # Anthropic responde 400 cuando se acaba el saldo
    elif status == 404 or (
        status in (400, 422)
        and any(w in low for w in _MODEL_WORDS)
        and any(w in low for w in _MODEL_MISSING_WORDS)
    ):
        code = MODEL_NOT_FOUND
    else:
        code = PROVIDER_ERROR
    return LLMError(
        code, model_attempted=model, detail=f"HTTP {status}: {body_text}", api_key=api_key
    )
