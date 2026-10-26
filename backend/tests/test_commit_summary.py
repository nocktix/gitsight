import json
import sqlite3
import subprocess

import pytest
from fastapi.testclient import TestClient

from app import commit_summary, llm, main, repository
from app.llm import AnalysisResult
from app.llm_errors import LLMError

URL = "https://github.com/UAICL/tarea02-ana"


def _git(repo, *args):
    subprocess.run(
        ["git", "-c", "user.name=Ana", "-c", "user.email=ana@example.com", *args],
        cwd=repo, check=True, capture_output=True,
    )


def _commit(repo, files: dict[str, str], message: str) -> str:
    for name, content in files.items():
        (repo / name).write_text(content)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", message)
    out = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    )
    return out.stdout.strip()


VALID = {
    "summary": "Agrega la clase Batalla en batalla.py.",
    "main_files": [{"filename": "batalla.py", "change": "Archivo nuevo con la clase Batalla."}],
    "message_check": {"status": "coincide", "observation": "El mensaje corresponde al archivo."},
}


class FakeLLM:
    """Reemplaza llm.analyze: devuelve las respuestas en orden y guarda los prompts."""

    def __init__(self, *responses, model="modelo-falso"):
        self.responses = list(responses) or [VALID]
        self.model = model
        self.prompts: list[tuple[str, str]] = []
        self.models: list[str | None] = []

    def __call__(self, system_prompt, user_prompt, config=None):
        self.prompts.append((system_prompt, user_prompt))
        self.models.append(config.model if config else None)
        item = self.responses[min(len(self.prompts), len(self.responses)) - 1]
        if isinstance(item, Exception):
            raise item
        text = item if isinstance(item, str) else json.dumps(item)
        return AnalysisResult(text, self.model, 10, 5, 15)

    @property
    def calls(self):
        return len(self.prompts)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "test.db"))
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    monkeypatch.setattr(main, "_resolve_repo", lambda repo_path, repo_url: repo)
    fake = FakeLLM()
    monkeypatch.setattr(llm, "analyze", fake)
    first = _commit(repo, {"batalla.py": "class Batalla:\n    pass\n"}, "Agrega clase Batalla")

    class Env:
        pass

    e = Env()
    e.client, e.repo, e.fake, e.first, e.db = TestClient(main.app), repo, fake, first, tmp_path / "test.db"
    return e


def _post(env, commit_hash=None, **body):
    return env.client.post(
        f"/api/commits/{commit_hash or env.first}/summary", json={"repo_url": URL, **body}
    )


def _get(env, commit_hash=None, url=URL):
    return env.client.get(
        f"/api/commits/{commit_hash or env.first}/summary", params={"repo_url": url}
    )


def _rows(env):
    conn = sqlite3.connect(env.db)
    try:
        return conn.execute("SELECT repo_url, commit_hash, model FROM commit_summaries").fetchall()
    finally:
        conn.close()


# --- generar y guardar ----------------------------------------------------------------


def test_post_generates_structured_summary_with_server_side_stats(env):
    r = _post(env)
    assert r.status_code == 200
    body = r.json()
    assert body["cached"] is False
    assert body["commit_hash"] == env.first
    assert body["model"] == "modelo-falso"
    assert body["summary"] == VALID["summary"]
    assert body["main_files"] == VALID["main_files"]
    assert body["message_check"] == VALID["message_check"]
    # Las cantidades las calcula el servidor a partir del diff, no el LLM.
    assert body["stats"] == {
        "files": 1, "added_files": 1, "modified_files": 0, "deleted_files": 0,
        "renamed_files": 0, "insertions": 2, "deletions": 0,
    }
    assert body["coverage"] == {
        "truncated": False, "files_total": 1, "files_complete": 1,
        "files_partial": 0, "files_omitted": 0,
    }
    assert body["created_at"].endswith("+00:00")
    assert _rows(env) == [(commit_summary.normalize_repo_url(URL), env.first, "modelo-falso")]


def test_saved_summary_is_returned_without_calling_the_llm(env):
    _post(env)
    again = _post(env).json()
    assert again["cached"] is True
    assert env.fake.calls == 1


def test_regenerate_replaces_the_saved_summary(env):
    _post(env)
    env.fake.responses = [{**VALID, "summary": "Resumen nuevo."}]
    env.fake.model = "otro-modelo"
    env.fake.prompts.clear()
    r = _post(env, regenerate=True).json()
    assert r["cached"] is False and r["summary"] == "Resumen nuevo."
    assert env.fake.calls == 1
    assert _rows(env) == [(commit_summary.normalize_repo_url(URL), env.first, "otro-modelo")]
    assert _get(env).json()["summary"] == "Resumen nuevo."


def test_prompts_are_in_spanish_and_carry_the_commit_message(env):
    _post(env)
    system, user = env.fake.prompts[0]
    assert "Escribe en español" in system
    assert "mensaje_generico" in system
    assert "<mensaje>\nAgrega clase Batalla\n</mensaje>" in user
    assert "+class Batalla:" in user
    assert "Contenido del diff: completo." in user


# --- consulta de lo guardado ----------------------------------------------------------


def test_get_is_404_until_generated_and_never_calls_the_llm(env):
    assert _get(env).status_code == 404
    _post(env)
    env.fake.prompts.clear()
    r = _get(env)
    assert r.status_code == 200 and r.json()["cached"] is True
    assert env.fake.calls == 0


def test_short_hash_finds_the_saved_summary(env):
    _post(env)
    assert _get(env, env.first[:7]).json()["commit_hash"] == env.first
    # También al generar con el hash corto: misma entrada, sin llamar al LLM de nuevo.
    assert _post(env, env.first[:7]).json()["cached"] is True
    assert len(_rows(env)) == 1


def test_short_hash_matching_two_saved_commits_is_an_error(env):
    for h in ("abc1234" + "0" * 33, "abc1234" + "f" * 33):
        repository.save_commit_summary(
            repo_url=commit_summary.normalize_repo_url(URL), commit_hash=h, model="m",
            result={k: VALID[k] for k in VALID} | {"stats": {}, "coverage": {}},
        )
    r = _get(env, "abc1234")
    assert r.status_code == 409
    assert "más de un commit" in r.json()["detail"]
    # Con el hash completo no hay ambigüedad (lo guardado no tiene la forma del modelo, por
    # eso se lee directo del repositorio).
    got = repository.get_commit_summary(commit_summary.normalize_repo_url(URL), "abc1234" + "0" * 33)
    assert got["commit_hash"] == "abc1234" + "0" * 33


def test_invalid_hash_is_400(env):
    assert _get(env, "zzzzzzz").status_code == 400
    assert _get(env, "abc").status_code == 400


def test_unknown_commit_is_404(env):
    assert _post(env, "1" * 40).status_code == 404


# --- URL del repo ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "variant",
    [
        "https://github.com/UAICL/tarea02-ana",
        "https://github.com/UAICL/tarea02-ana.git",
        "https://github.com/UAICL/tarea02-ana/",
        "  https://github.com/uaicl/Tarea02-Ana.git/ ",
        "http://www.github.com/UAICL/tarea02-ana",
        "github.com/UAICL/tarea02-ana",
    ],
)
def test_url_written_differently_uses_the_same_entry(env, variant):
    assert commit_summary.normalize_repo_url(variant) == "https://github.com/uaicl/tarea02-ana"
    _post(env)
    assert _get(env, url=variant).status_code == 200
    assert len(_rows(env)) == 1


def test_different_repos_do_not_share_summaries(env):
    _post(env)
    assert _get(env, url="https://github.com/UAICL/tarea02-beto").status_code == 404


# --- diffs grandes --------------------------------------------------------------------


def test_big_diff_is_truncated_and_coverage_says_so(env):
    big = "".join(f"linea_{i} = {i}\n" for i in range(3_000))
    sha = _commit(env.repo, {"grande.py": big, "otro.py": "x = 1\n"}, "Agrega archivos")
    r = _post(env, sha).json()
    assert r["coverage"]["truncated"] is True
    assert r["coverage"]["files_partial"] == 1
    assert r["coverage"]["files_total"] == 2
    assert r["stats"]["insertions"] == 3_001  # se cuentan todas las líneas, no solo las enviadas
    system, user = env.fake.prompts[-1]
    assert "recortado: se muestran" in user
    assert "Contenido del diff: parcial" in user
    assert len(user) < commit_summary.MAX_TOTAL_CHARS + 2_000


def test_total_limit_omits_files_that_do_not_fit(env, monkeypatch):
    monkeypatch.setattr(commit_summary, "MAX_FILE_CHARS", 500)
    monkeypatch.setattr(commit_summary, "MAX_TOTAL_CHARS", 700)
    files = {f"f{i}.py": "".join(f"v{j} = {j}\n" for j in range(100)) for i in range(4)}
    sha = _commit(env.repo, files, "Agrega cuatro archivos")
    r = _post(env, sha).json()
    cov = r["coverage"]
    assert cov["truncated"] and cov["files_omitted"] >= 1 and cov["files_total"] == 4
    assert cov["files_complete"] + cov["files_partial"] + cov["files_omitted"] == 4
    assert "contenido omitido por el límite de tamaño" in env.fake.prompts[-1][1]


def test_small_commit_is_not_truncated(env):
    assert _post(env).json()["coverage"]["truncated"] is False


def test_commit_without_changes_is_400_and_does_not_call_the_llm(env):
    _git(env.repo, "commit", "--allow-empty", "-m", "vacío")
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=env.repo, capture_output=True, text=True
    ).stdout.strip()
    r = _post(env, sha)
    assert r.status_code == 400
    assert env.fake.calls == 0


# --- mensajes genéricos ---------------------------------------------------------------


def test_generic_message_status_is_accepted(env):
    sha = _commit(env.repo, {"a.py": "a = 1\n"}, "update")
    env.fake.responses = [
        {**VALID, "message_check": {"status": "mensaje_generico", "observation": "El mensaje es 'update'."}}
    ]
    r = _post(env, sha).json()
    assert r["message_check"]["status"] == "mensaje_generico"
    assert "<mensaje>\nupdate\n</mensaje>" in env.fake.prompts[-1][1]


# --- fallos del LLM -------------------------------------------------------------------


def test_malformed_answer_is_retried_once(env):
    env.fake.responses = ["esto no es JSON", VALID]
    r = _post(env)
    assert r.status_code == 200
    assert env.fake.calls == 2
    assert "no fue JSON válido o no tenía la estructura" in env.fake.prompts[1][1]


def test_invalid_status_counts_as_malformed(env):
    bad = {**VALID, "message_check": {"status": "genial", "observation": "x"}}
    env.fake.responses = [bad, bad]
    r = _post(env)
    assert r.status_code == 502
    assert r.json()["error"] == "llm_invalid_response_format"
    assert env.fake.calls == 2
    assert _rows(env) == []


def test_provider_failure_is_502_and_nothing_is_saved(env):
    env.fake.responses = [LLMError("provider_error", model_attempted="m")]
    r = _post(env)
    assert r.status_code == 502 and r.json()["error"] == "provider_error"
    assert _rows(env) == []
    assert _get(env).status_code == 404


def test_failed_regeneration_keeps_the_previous_summary(env):
    _post(env)
    env.fake.responses = [LLMError("provider_error", model_attempted="m")]
    assert _post(env, regenerate=True).status_code == 502
    assert _get(env).json()["summary"] == VALID["summary"]


def test_db_failure_does_not_lose_the_summary(env, monkeypatch):
    def boom(**_):
        raise sqlite3.OperationalError("disco lleno")

    monkeypatch.setattr(repository, "save_commit_summary", boom)
    r = _post(env)
    assert r.status_code == 200 and r.json()["summary"] == VALID["summary"]
