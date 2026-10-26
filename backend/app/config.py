"""Configuración del backend de triangulación."""

import os

from dotenv import load_dotenv

load_dotenv()

# El bot de GitHub Classroom nunca es un estudiante: siempre se excluye.
ALWAYS_EXCLUDED_AUTHORS = ["github-classroom[bot]"]


def parse_excluded_authors(value: str | None) -> list[str]:
    """Cuentas a excluir de las métricas: el bot de Classroom más las que se listen en
    `TID_EXCLUDED_AUTHORS` (nombres separados por comas, sin importar mayúsculas)."""
    extra = [name.strip() for name in (value or "").split(",") if name.strip()]
    seen: set[str] = set()
    result: list[str] = []
    for name in ALWAYS_EXCLUDED_AUTHORS + extra:
        if name.casefold() not in seen:
            seen.add(name.casefold())
            result.append(name)
    return result


# Autores que no son estudiantes (bots, profesores y ayudantes): sus commits inflarían las
# métricas de contribución. Se configuran en el .env con TID_EXCLUDED_AUTHORS.
EXCLUDED_AUTHORS = parse_excluded_authors(os.environ.get("TID_EXCLUDED_AUTHORS"))
_EXCLUDED_FOLDED = {name.casefold() for name in EXCLUDED_AUTHORS}


def is_excluded_author(name: str) -> bool:
    return name.casefold() in _EXCLUDED_FOLDED
