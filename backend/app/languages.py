"""Idiomas en que el LLM puede responder, elegidos por el evaluador en el frontend.

Los prompts están en inglés y terminan con "Produce the answer in <idioma>.". Solo se aceptan
los códigos de esta lista: el nombre que llega al prompt nunca es texto libre del usuario."""

LANGUAGES: dict[str, str] = {
    "es": "Spanish",
    "en": "English",
}
DEFAULT_LANGUAGE = "es"


def language_name(code: str | None) -> str:
    """Nombre en inglés del idioma (el que va en el prompt); el idioma por defecto si falta."""
    return LANGUAGES.get(code or DEFAULT_LANGUAGE, LANGUAGES[DEFAULT_LANGUAGE])


def with_language(system_prompt: str, code: str | None) -> str:
    """El system prompt con la instrucción de idioma como última línea."""
    return f"{system_prompt}\n\nProduce the answer in {language_name(code)}."


def check_language(value: str | None) -> str:
    """Validador para los modelos de pydantic: código conocido, o el por defecto si viene vacío."""
    if not value:
        return DEFAULT_LANGUAGE
    if value not in LANGUAGES:
        raise ValueError(
            "Idioma no soportado. Opciones: " + ", ".join(sorted(LANGUAGES)) + "."
        )
    return value
