import pytest


@pytest.fixture(autouse=True)
def env_fallback_key(monkeypatch):
    """Los tests no dependen del .env real: el respaldo es una key falsa fija."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-falsa")
