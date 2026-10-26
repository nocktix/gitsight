"""Versiones de la rúbrica por tarea: creación, dedupe, activación, uso en los análisis,
migración con respaldo y comparación."""

import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import db, llm, main, rubrics

TASK = "UAICL/tarea02"
BASE = f"/api/tasks/{TASK}/rubric"
URL = "https://github.com/UAICL/tarea02-ana"

R1 = """| Criterio | Descripción |
|---|---|
| C1 - Control de versiones | Commits frecuentes y descriptivos. |
| C2 - Contribución individual | Cada integrante tiene commits propios. |
| C3 - Plazos | Entrega dentro de las fechas. |
"""
R2 = """| Criterio | Descripción |
|---|---|
| C1 - Control de versiones | Commits frecuentes, descriptivos y sin bloques gigantes. |
| C2 - Contribución individual | Cada integrante tiene commits propios. |
| C4 - Uso documentado de IA | La bitácora registra el uso de IA. |
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "t.db"))
    return TestClient(main.app)


def _post(client, content, **body):
    r = client.post(f"{BASE}/versions", json={"content": content, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _versions(client):
    return client.get(f"{BASE}/versions").json()


def _db(tmp_path, sql, *args):
    conn = sqlite3.connect(tmp_path / "t.db")
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


# --- creación y activación --------------------------------------------------------------------


def test_versions_are_numbered_and_never_overwritten(client):
    v1 = _post(client, R1, filename="rubrica.pdf", note="la original")
    v2 = _post(client, R2, filename="rubrica_v2.docx", note="agrega IA")
    assert (v1["version"], v2["version"]) == (1, 2)
    assert v1["created"] and v2["created"]
    listed = _versions(client)
    assert [v["version"] for v in listed] == [2, 1]  # la más reciente primero
    assert [v["filename"] for v in listed] == ["rubrica_v2.docx", "rubrica.pdf"]
    assert [v["note"] for v in listed] == ["agrega IA", "la original"]
    assert client.get(f"{BASE}/versions/1").json()["content"] == R1  # la v1 sigue intacta


def test_list_is_light_unless_content_is_requested(client):
    _post(client, R1)
    item = _versions(client)[0]
    assert "content" not in item and item["criteria_count"] == 3
    full = client.get(f"{BASE}/versions", params={"include_content": True}).json()[0]
    assert full["content"] == R1 and [c["id"] for c in full["criteria"]] == ["C1", "C2", "C3"]


def test_first_version_and_new_uploads_become_active_by_default(client):
    _post(client, R1)
    assert client.get(BASE).json()["version"] == 1
    _post(client, R2)
    assert client.get(BASE).json()["version"] == 2
    assert [v["active"] for v in _versions(client)] == [True, False]


def test_upload_without_activating_keeps_the_active_one(client):
    _post(client, R1)
    v2 = _post(client, R2, activate=False)
    assert v2["active"] is False
    assert client.get(BASE).json()["version"] == 1


def test_only_one_version_is_active_and_it_is_enforced_by_the_database(client, tmp_path):
    _post(client, R1)
    _post(client, R2)
    assert sum(v["active"] for v in _versions(client)) == 1
    with pytest.raises(sqlite3.IntegrityError):
        conn = sqlite3.connect(tmp_path / "t.db")
        conn.execute("UPDATE rubrics SET active = 1 WHERE version = 1")  # ya hay otra activa


def test_activating_an_old_version_does_not_duplicate_it(client):
    _post(client, R1)
    _post(client, R2)
    r = client.post(f"{BASE}/versions/1/activate")
    assert r.status_code == 200 and r.json()["version"] == 1 and r.json()["active"] is True
    assert client.get(BASE).json()["version"] == 1
    assert [v["active"] for v in _versions(client)] == [False, True]
    assert len(_versions(client)) == 2
    assert client.post(f"{BASE}/versions/1/activate").status_code == 200  # idempotente


def test_activate_unknown_version_is_404(client):
    _post(client, R1)
    assert client.post(f"{BASE}/versions/9/activate").status_code == 404
    assert client.get(f"{BASE}/versions/9").status_code == 404
    assert client.get(BASE).json()["version"] == 1  # no cambió nada


def test_identical_content_of_any_version_is_not_duplicated(client):
    _post(client, R1, note="la original")
    _post(client, R2)  # v2 activa
    again = _post(client, R1, note="otra nota", filename="otra.pdf")  # idéntica a la v1, no a la activa
    assert again["created"] is False and again["version"] == 1
    assert again["note"] == "la original"  # no se pisa lo ya guardado
    assert len(_versions(client)) == 2
    assert client.get(BASE).json()["version"] == 1  # activate=True activó la existente


def test_identical_content_ignores_whitespace_and_respects_activate_false(client):
    _post(client, "Criterio  1\nCriterio 2")
    _post(client, R2)
    again = _post(client, "Criterio 1 Criterio 2\n\n", activate=False)
    assert again["created"] is False and again["version"] == 1
    assert client.get(BASE).json()["version"] == 2  # sin activate no se activa


def test_filename_keeps_only_the_basename_and_note_is_limited(client):
    v = _post(client, R1, filename="C:\\Users\\ana\\Escritorio\\rubrica.pdf")
    assert v["filename"] == "rubrica.pdf"
    assert _post(client, R2, filename="/tmp/x/rubrica2.md")["filename"] == "rubrica2.md"
    r = client.post(f"{BASE}/versions", json={"content": "otra", "note": "x" * 501})
    assert r.status_code == 422
    assert client.post(f"{BASE}/versions", json={"content": "  "}).status_code == 422


def test_put_rubric_endpoint_is_gone_and_missing_rubric_is_404(client):
    assert client.get(BASE).status_code == 404
    assert client.put(BASE, json={"content": "A"}).status_code == 405
    assert _versions(client) == []


# --- los análisis usan la versión activa -----------------------------------------------------------


@pytest.fixture
def analyze_env(client, monkeypatch, tmp_path):
    t = datetime(2026, 5, 27, 9, 0, tzinfo=timezone(timedelta(hours=-4)))
    commits = [{"hash": "aaaaaaa", "full_hash": "a" * 40, "author": "ana", "moment": t,
                "date": "d", "message": "m", "merge": False, "files": [], "stats": {}}]
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setattr(main, "_resolve_repo", lambda *_: repo)
    monkeypatch.setattr(main.git_analyzer, "extract_commits", lambda _p: commits)
    monkeypatch.setattr(main.git_analyzer, "format_commits_for_prompt", lambda c: "x")
    monkeypatch.setattr(main.alert_checks, "bitacora_commits", lambda c, *a: [])
    seen = {}

    def fake(system_prompt, user_prompt, **_):
        seen["prompt"] = user_prompt
        finding = {"type": "info", "criterion": "C1 - Control de versiones", "title": "t",
                   "description": "d", "evidence": [], "no_evidence_needed": False}
        return ({"findings": [finding], "not_assessable": [], "summary": "s"},
                llm.AnalysisResult("", "m", 1, 1, 2))

    monkeypatch.setattr(llm, "analyze_structured", fake)
    return seen


def _analyze(client, **extra):
    r = client.post("/api/analyze", json={"repo_url": URL, "task_id": TASK, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _saved(client):
    return client.get("/api/analyses", params={"group_url": URL}).json()[0]


def test_new_analysis_uses_the_active_version_without_being_told(client, analyze_env):
    _post(client, R1)
    _post(client, R2)  # activa
    out = _analyze(client)
    assert "C4 - Uso documentado de IA" in analyze_env["prompt"]
    assert "C3 - Plazos" not in analyze_env["prompt"]
    assert out["rubric_version"] == 2 and "rubric" in out["sources_used"]
    row = _saved(client)
    assert (row["rubric_version"], row["rubric_state"]) == (2, "version")


def test_after_activating_v1_new_analyses_use_v1(client, analyze_env):
    _post(client, R1)
    _post(client, R2)
    client.post(f"{BASE}/versions/1/activate")
    _analyze(client)
    assert "C3 - Plazos" in analyze_env["prompt"] and "C4" not in analyze_env["prompt"]
    assert _saved(client)["rubric_version"] == 1


def test_explicit_version_wins_over_the_sent_text(client, analyze_env):
    _post(client, R1)
    _post(client, R2)
    _analyze(client, rubric="texto suelto cualquiera", rubric_version=1)
    assert "C3 - Plazos" in analyze_env["prompt"] and "texto suelto" not in analyze_env["prompt"]
    assert _saved(client)["rubric_version"] == 1


def test_task_without_rubric_saves_state_none(client, analyze_env):
    _analyze(client)
    row = _saved(client)
    assert (row["rubric_version"], row["rubric_state"]) == (None, "none")
    assert "No se proporcionó rúbrica" in analyze_env["prompt"]


def test_loose_text_that_matches_no_version_is_unknown_never_invented(client, analyze_env):
    _post(client, R1)
    _analyze(client, rubric="Otra rúbrica que nadie subió")
    row = _saved(client)
    assert (row["rubric_version"], row["rubric_state"]) == (None, "unknown")


def test_loose_text_matching_a_version_gets_that_version(client, analyze_env):
    _post(client, R1)
    _post(client, R2)
    _analyze(client, rubric=R1)
    assert (_saved(client)["rubric_version"], _saved(client)["rubric_state"]) == (1, "version")


# --- migración -------------------------------------------------------------------------------------

OLD_SCHEMA = """
CREATE TABLE tasks (id TEXT PRIMARY KEY, start_date TEXT, end_date TEXT);
CREATE TABLE groups (url TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE rubrics (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, version INTEGER NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (task_id, version));
CREATE TABLE analyses (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, group_url TEXT NOT NULL,
    rubric_version INTEGER, model TEXT NOT NULL, head_commit TEXT, created_at TEXT NOT NULL,
    result_json TEXT NOT NULL, UNIQUE (group_url, created_at));
"""


def _old_db(path, rubric_versions=2):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.execute("INSERT INTO tasks (id) VALUES (?)", (TASK,))
    conn.execute("INSERT INTO tasks (id) VALUES ('UAICL/otra')")
    for v in range(1, rubric_versions + 1):
        conn.execute("INSERT INTO rubrics (task_id, version, content, created_at) VALUES (?, ?, ?, ?)",
                     (TASK, v, f"R{v}", f"2026-05-0{v}T00:00:00.000000+00:00"))
    rows = [
        ("a", 1, {"sources_used": ["commits", "rubric"]}),      # con versión
        ("b", None, {"sources_used": ["commits", "rubric"]}),   # usó rúbrica, no se sabe cuál
        ("c", None, {"sources_used": ["commits"]}),             # sin rúbrica
        ("d", None, {"findings": []}),                          # no hay forma de saberlo
    ]
    for stamp, version, result in rows:
        conn.execute(
            "INSERT INTO analyses (task_id, group_url, rubric_version, model, created_at, result_json) "
            "VALUES (?, ?, ?, 'm', ?, ?)", (TASK, f"https://g/{stamp}", version, stamp, json.dumps(result)))
    conn.commit()
    conn.close()


def _migrate(tmp_path, monkeypatch, **kw):
    path = tmp_path / "tid.db"
    _old_db(path, **kw)
    monkeypatch.setenv("TID_DB_PATH", str(path))
    db._initialized.discard(str(path))
    with db.connect() as conn:
        return path, conn


def test_migration_activates_the_existing_rubric_as_v1(tmp_path, monkeypatch):
    path, _ = _migrate(tmp_path, monkeypatch, rubric_versions=1)
    rows = sqlite3.connect(path).execute("SELECT version, active, filename, note FROM rubrics").fetchall()
    assert rows == [(1, 1, None, None)]
    client = TestClient(main.app)
    assert client.get(BASE).json()["version"] == 1
    assert client.get("/api/tasks/UAICL/otra/rubric").status_code == 404  # tarea sin rúbrica: nada inventado


def test_migration_with_several_old_versions_activates_the_latest_and_keeps_numbers(tmp_path, monkeypatch):
    path, _ = _migrate(tmp_path, monkeypatch, rubric_versions=3)
    rows = sqlite3.connect(path).execute("SELECT version, active FROM rubrics ORDER BY version").fetchall()
    assert rows == [(1, 0), (2, 0), (3, 1)]


def test_migration_never_invents_a_version_for_old_analyses(tmp_path, monkeypatch):
    path, _ = _migrate(tmp_path, monkeypatch)
    got = dict(
        (r[0], (r[1], r[2]))
        for r in sqlite3.connect(path).execute("SELECT created_at, rubric_version, rubric_state FROM analyses")
    )
    assert got == {"a": (1, "version"), "b": (None, "unknown"), "c": (None, "none"), "d": (None, "unknown")}


def test_migration_backs_up_the_existing_database_once(tmp_path, monkeypatch):
    path, _ = _migrate(tmp_path, monkeypatch)
    backups = sorted(tmp_path.glob("tid.db.bak-*"))
    assert len(backups) == 1
    old = sqlite3.connect(backups[0])
    assert "active" not in {r[1] for r in old.execute("PRAGMA table_info(rubrics)")}  # esquema anterior
    assert old.execute("SELECT COUNT(*) FROM analyses").fetchone()[0] == 4  # con sus datos
    # abrirla de nuevo (otro arranque) no cambia nada: no hay segundo respaldo
    db._initialized.discard(str(path))
    with db.connect():
        pass
    assert len(list(tmp_path.glob("tid.db.bak-*"))) == 1


def test_fresh_or_current_database_gets_no_backup(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "nueva.db"))
    db._initialized.discard(str(tmp_path / "nueva.db"))
    with db.connect():
        pass
    db._initialized.discard(str(tmp_path / "nueva.db"))
    with db.connect():
        pass
    assert list(tmp_path.glob("*.bak-*")) == []


# --- criterios y comparación -------------------------------------------------------------------------


def test_parse_criteria_from_table_docx_lines_and_numbered_lists():
    assert [c["id"] for c in rubrics.parse_criteria(R1)] == ["C1", "C2", "C3"]
    docx = "Criterio | Descripción\nC1 - Uso de Git | Commits frecuentes\nC2 - Plazos | A tiempo"
    got = rubrics.parse_criteria(docx)
    assert got[0] == {"id": "C1", "title": "Uso de Git", "description": "Commits frecuentes"}
    lista = "1. Control de versiones\n   Commits frecuentes.\n2) Plazos\n2026-05-27 fecha suelta"
    got = rubrics.parse_criteria(lista)
    assert [c["id"] for c in got] == ["1", "2"]
    assert "Commits frecuentes." in got[0]["description"]  # la línea siguiente se suma a la descripción
    assert "2026-05-27" in got[1]["description"]  # una fecha no es un criterio


def test_text_without_criteria_is_not_structured():
    assert not rubrics.is_structured(rubrics.parse_criteria("Texto libre sin criterios numerados."))
    assert not rubrics.is_structured(rubrics.parse_criteria("C1 - Uno solo"))


def test_compare_reports_added_removed_and_modified(client):
    _post(client, R1)
    _post(client, R2)
    r = client.get(f"{BASE}/compare", params={"from": 1, "to": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["structured"] is True
    assert [c["id"] for c in body["added"]] == ["C4"]
    assert [c["id"] for c in body["removed"]] == ["C3"]
    assert [m["id"] for m in body["modified"]] == ["C1"]
    assert body["modified"][0]["changed"] == ["description"]
    assert body["unchanged"] == 1  # C2
    assert body["from"]["version"] == 1 and body["to"]["content"] == R2


def test_compare_matches_a_renumbered_criterion_by_title():
    out = rubrics.compare(
        "C1 - Uso de Git | A\nC2 - Plazos | B", "C1 - Uso de Git | A\nC5 - Plazos | B"
    )
    assert out["added"] == [] and out["removed"] == []
    assert out["modified"][0]["changed"] == ["id"]


def test_compare_of_unstructured_rubrics_says_so_without_inventing_differences(client):
    _post(client, "Rúbrica en texto libre, versión uno.")
    _post(client, "Rúbrica en texto libre, versión dos.")
    body = client.get(f"{BASE}/compare", params={"from": 1, "to": 2}).json()
    assert body["structured"] is False
    assert body["added"] == body["removed"] == body["modified"] == []
    assert body["from"]["content"] and body["to"]["content"]  # el frontend los muestra lado a lado


def test_compare_validates_versions(client):
    _post(client, R1)
    _post(client, R2)
    assert client.get(f"{BASE}/compare", params={"from": 1, "to": 1}).status_code == 400
    assert client.get(f"{BASE}/compare", params={"from": 1, "to": 9}).status_code == 404
    assert client.get(f"{BASE}/compare", params={"from": 1}).status_code == 422
