import pytest


@pytest.fixture(autouse=True)
def env_fallback_key(monkeypatch):
    """Los tests no dependen del .env real: el respaldo es una key falsa fija."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-falsa")


@pytest.fixture(autouse=True)
def clean_failed_models():
    """El registro de modelos caídos del modo Automático es global: cada test parte vacío."""
    from app import llm

    llm.clear_failed_models()
    yield
    llm.clear_failed_models()
