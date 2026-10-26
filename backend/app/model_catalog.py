"""Catálogo de modelos de OpenRouter disponibles, leído de models_config.json.

Para agregar, quitar o reordenar modelos basta editar ese archivo (y reiniciar el backend).
"""

import json
from pathlib import Path

CONFIG_PATH = Path(__file__).with_name("models_config.json")


class ModelCatalogError(Exception):
    """models_config.json no existe o no tiene la forma esperada."""


def _load() -> tuple[str, list[dict]]:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        models = [
            {"id": m["id"], "name": m["name"], "free": bool(m["free"])} for m in data["models"]
        ]
        primary = data["primary"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ModelCatalogError(f"No se pudo leer {CONFIG_PATH.name}: {exc}") from exc
    ids = [m["id"] for m in models]
    if not models or len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        raise ModelCatalogError(f"{CONFIG_PATH.name}: la lista de modelos está vacía o repetida.")
    if primary not in ids:
        raise ModelCatalogError(f"{CONFIG_PATH.name}: el modelo principal no está en la lista.")
    return primary, models


def primary_model() -> str:
    return _load()[0]


def list_models() -> list[dict]:
    return _load()[1]


def is_known(model_id: str) -> bool:
    return any(m["id"] == model_id for m in list_models())


def fallback_chain() -> list[str]:
    """Orden del modo Automático: el principal primero y luego el resto, en el orden del archivo."""
    primary, models = _load()
    return [primary] + [m["id"] for m in models if m["id"] != primary]


def matches_requested(saved: dict, requested: str) -> bool:
    """¿Un resumen guardado sirve para el modelo pedido? Se compara contra el modelo que se
    pidió al generarlo (un router como openrouter/free responde con otro modelo). Las filas
    anteriores a requested_model o generadas en Automático no lo tienen: ahí se compara con el
    modelo que respondió, ignorando el sufijo ':free' que OpenRouter a veces omite."""
    if saved.get("requested_model"):
        return saved["requested_model"] == requested
    return saved["model"].removesuffix(":free") == requested.removesuffix(":free")
