"""Selección de modelo: catálogo, GET /api/models y el campo `llm` de las peticiones (LLM simulado)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import llm, llm_providers, main, model_catalog
from app.llm_errors import LLMError, LLMResponseFormatError
from tests.test_commit_summary import URL, VALID, _commit, _git, _rows
from tests.test_commit_summary import _post as _post_body

CATALOG = {
    "primary": "m/b:free",
    "models": [
        {"id": "m/a:free", "name": "A", "free": True},
        {"id": "m/b:free", "name": "B", "free": True},
        {"id": "m/c", "name": "C", "free": False},
    ],
}

def _post(env, model=None, **body):
    if model is not None:
        body["llm"] = {"provider": "openrouter", "model": model}
    return _post_body(env, **body)


def _cfg(model):
    return llm_providers.LLMConfig("openrouter", model, "https://openrouter.ai/api/v1", "k")


def OR(model):
    return {"provider": "openrouter", "model": model}


FINDINGS = {"findings": [], "not_assessable": [], "summary": "s"}


@pytest.fixture(autouse=True)
def catalog(tmp_path, monkeypatch):
    path = tmp_path / "models.json"
    path.write_text(json.dumps(CATALOG))
    monkeypatch.setattr(model_catalog, "CONFIG_PATH", path)
    return path


class FakeProvider:
    """Reemplaza llm._call_model: registra los modelos pedidos y falla los indicados."""

    def __init__(self, failing=(), text=None):
        self.failing = set(failing)
        self.text = text if text is not None else json.dumps(VALID)
        self.called: list[str] = []

    def __call__(self, config, system_prompt, user_prompt):
        model = config.model
        self.called.append(model)
        if model in self.failing:
            raise LLMError("provider_error", model_attempted=model)
        return llm.AnalysisResult(self.text, model, 1, 1, 2)


@pytest.fixture
def provider(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(llm, "_call_model", fake)
    return fake


# --- catálogo y GET /api/models --------------------------------------------------------


def test_models_endpoint_lists_models_and_primary(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-secreto")
    r = TestClient(main.app).get("/api/models")
    assert r.status_code == 200
    assert r.json() == CATALOG
    assert "sk-or-secreto" not in r.text


def test_real_config_file_is_valid(monkeypatch):
    real = model_catalog.Path(model_catalog.__file__).with_name("models_config.json")
    monkeypatch.setattr(model_catalog, "CONFIG_PATH", real)
    assert model_catalog.primary_model() in [m["id"] for m in model_catalog.list_models()]


def test_invalid_config_is_reported(catalog):
    catalog.write_text(json.dumps({**CATALOG, "primary": "no/existe"}))
    with pytest.raises(model_catalog.ModelCatalogError):
        model_catalog.list_models()


# --- llm.analyze -----------------------------------------------------------------------


def test_automatic_mode_tries_primary_first_then_the_rest(provider):
    provider.failing = {"m/b:free", "m/a:free"}
    result = llm.analyze("s", "u")
    assert provider.called == ["m/b:free", "m/a:free", "m/c"]
    assert result.model_used == "m/c"


def test_automatic_mode_raises_last_error_when_all_fail(provider):
    provider.failing = {"m/a:free", "m/b:free", "m/c"}
    with pytest.raises(LLMError) as exc:
        llm.analyze("s", "u")
    assert exc.value.model_attempted == "m/c"


def test_explicit_model_uses_only_that_model_without_fallback(provider):
    provider.failing = {"m/a:free"}
    with pytest.raises(LLMError) as exc:
        llm.analyze("s", "u", config=_cfg("m/a:free"))
    assert provider.called == ["m/a:free"]
    assert exc.value.model_attempted == "m/a:free"


def test_format_retry_stays_on_the_same_model(provider):
    provider.text = "no es json"
    with pytest.raises(LLMResponseFormatError) as exc:
        llm.analyze_structured("s", "u", config=_cfg("m/c"))
    assert provider.called == ["m/c", "m/c"]
    assert exc.value.model == "m/c"


# --- POST /api/analyze ------------------------------------------------------------------


@pytest.fixture
def analyze_client(tmp_path, monkeypatch, provider):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "t.db"))
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setattr(main, "_resolve_repo", lambda *_: repo)
    monkeypatch.setattr(main.git_analyzer, "extract_commits", lambda _p: [])
    monkeypatch.setattr(main.git_analyzer, "format_commits_for_prompt", lambda c: "x")
    monkeypatch.setattr(main.alert_checks, "bitacora_commits", lambda c, *a: [])
    provider.text = json.dumps(FINDINGS)
    return TestClient(main.app)


def test_analyze_without_model_uses_the_fallback_chain(analyze_client, provider):
    provider.failing = {"m/b:free"}
    r = analyze_client.post("/api/analyze", json={"repo_url": URL})
    assert r.status_code == 200
    assert provider.called == ["m/b:free", "m/a:free"]
    assert r.json()["model_used"] == "m/a:free"


def test_analyze_with_model_uses_only_that_model(analyze_client, provider):
    r = analyze_client.post("/api/analyze", json={"repo_url": URL, "llm": OR("m/c")})
    assert r.status_code == 200
    assert provider.called == ["m/c"]
    assert r.json()["model_used"] == "m/c"


def test_analyze_with_failing_model_is_502_naming_the_model(analyze_client, provider):
    provider.failing = {"m/c"}
    r = analyze_client.post("/api/analyze", json={"repo_url": URL, "llm": OR("m/c")})
    assert r.status_code == 502
    body = r.json()
    assert body["error"] == "provider_error"
    assert body["model_attempted"] == "m/c"
    assert provider.called == ["m/c"]


def test_analyze_with_bad_format_names_the_model(analyze_client, provider):
    provider.text = "basura"
    r = analyze_client.post("/api/analyze", json={"repo_url": URL, "llm": OR("m/a:free")})
    assert r.status_code == 502
    assert r.json()["model_attempted"] == "m/a:free"
    assert "m/a:free" in r.json()["message"]


# --- POST /api/commits/{hash}/summary ---------------------------------------------------


@pytest.fixture
def summary_env(tmp_path, monkeypatch, provider):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "test.db"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    monkeypatch.setattr(main, "_resolve_repo", lambda repo_path, repo_url: repo)
    first = _commit(repo, {"batalla.py": "class Batalla:\n    pass\n"}, "Agrega clase Batalla")

    class Env:
        pass

    e = Env()
    e.client, e.first, e.db, e.provider = TestClient(main.app), first, tmp_path / "test.db", provider
    return e


def test_summary_with_model_uses_only_that_model(summary_env):
    summary_env.provider.failing = {"m/a:free"}
    r = _post(summary_env, model="m/a:free")
    assert r.status_code == 502
    assert r.json()["model_attempted"] == "m/a:free"
    assert summary_env.provider.called == ["m/a:free"]
    assert _rows(summary_env) == []


def test_summary_without_model_uses_the_fallback_chain(summary_env):
    summary_env.provider.failing = {"m/b:free"}
    r = _post(summary_env)
    assert r.status_code == 200 and r.json()["model"] == "m/a:free"
    assert summary_env.provider.called == ["m/b:free", "m/a:free"]


def test_saved_summary_from_the_same_model_is_returned(summary_env):
    assert _post(summary_env, model="m/a:free").json()["cached"] is False
    r = _post(summary_env, model="m/a:free")
    assert r.json()["cached"] is True and r.json()["model"] == "m/a:free"
    assert summary_env.provider.called == ["m/a:free"]


def test_saved_summary_from_another_model_is_regenerated_and_replaced(summary_env):
    _post(summary_env, model="m/a:free")
    r = _post(summary_env, model="m/c")
    assert r.status_code == 200
    assert r.json()["cached"] is False and r.json()["model"] == "m/c"
    assert summary_env.provider.called == ["m/a:free", "m/c"]
    assert [row[2] for row in _rows(summary_env)] == ["m/c"]


def test_without_model_any_saved_summary_is_returned(summary_env):
    _post(summary_env, model="m/c")
    r = _post(summary_env)
    assert r.json()["cached"] is True and r.json()["model"] == "m/c"
    assert summary_env.provider.called == ["m/c"]


# --- modelo pedido vs. modelo realmente usado (routers como openrouter/free) ----------------


def _router_answers_with(summary_env, real):
    """Hace que cualquier modelo pedido responda como `real` (como openrouter/free)."""
    def call(config, system_prompt, user_prompt):
        summary_env.provider.called.append(config.model)
        return llm.AnalysisResult(json.dumps(VALID), real, 1, 1, 2)

    return call


def test_router_summary_is_reused_by_requested_model(summary_env, monkeypatch):
    monkeypatch.setattr(llm, "_call_model", _router_answers_with(summary_env, "otro/modelo-real"))
    first = _post(summary_env, model="m/c").json()
    # En pantalla se sigue mostrando el modelo que realmente respondió...
    assert first["model"] == "otro/modelo-real"
    assert _rows(summary_env)[0][2] == "otro/modelo-real"
    # ...pero la decisión de reutilizar compara contra el pedido.
    again = _post(summary_env, model="m/c").json()
    assert again["cached"] is True and again["model"] == "otro/modelo-real"
    assert summary_env.provider.called == ["m/c"]


def test_router_summary_is_regenerated_for_a_different_requested_model(summary_env, monkeypatch):
    monkeypatch.setattr(llm, "_call_model", _router_answers_with(summary_env, "otro/modelo-real"))
    _post(summary_env, model="m/c")
    r = _post(summary_env, model="m/a:free").json()
    assert r["cached"] is False
    assert summary_env.provider.called == ["m/c", "m/a:free"]


def test_requested_model_is_stored_and_null_in_automatic_mode(summary_env):
    import sqlite3

    def requested():
        conn = sqlite3.connect(summary_env.db)
        try:
            return conn.execute("SELECT requested_model FROM commit_summaries").fetchall()
        finally:
            conn.close()

    _post(summary_env)
    assert requested() == [(None,)]
    _post(summary_env, model="m/c")
    assert requested() == [("m/c",)]


def test_old_database_gets_the_requested_model_column(tmp_path, monkeypatch):
    import sqlite3
    from app import db

    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE commit_summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, repo_url TEXT NOT NULL,"
        " commit_hash TEXT NOT NULL, model TEXT NOT NULL, result_json TEXT NOT NULL,"
        " created_at TEXT NOT NULL, UNIQUE (repo_url, commit_hash))"
    )
    conn.commit()
    conn.close()
    monkeypatch.setenv("TID_DB_PATH", str(path))
    db._initialized.discard(str(path))
    with db.connect() as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(commit_summaries)")}
    assert "requested_model" in cols


# --- abrir un commit nunca llama al LLM ----------------------------------------------------


def test_get_never_calls_the_llm_and_shows_the_saved_model(summary_env):
    _post(summary_env, model="m/a:free")
    summary_env.provider.called.clear()
    # El modelo elegido ahora es otro, pero el GET no recibe modelo: devuelve lo guardado.
    r = summary_env.client.get(
        f"/api/commits/{summary_env.first}/summary", params={"repo_url": URL, "model": "m/c"}
    )
    assert r.status_code == 200
    assert r.json()["model"] == "m/a:free" and r.json()["cached"] is True
    assert summary_env.provider.called == []
