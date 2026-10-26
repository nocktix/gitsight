import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db, llm, main, repository

TASK = "UAICL/tarea02"
URL_A = "https://github.com/UAICL/tarea02-ana"
URL_B = "https://github.com/UAICL/tarea02-beto"


def _put_rubric(client, path, content):
    """Sube una versión nueva por la API de versiones (path es .../tasks/<id>/rubric)."""
    return client.post(path + "/versions", json={"content": content})


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "test.db"))
    return TestClient(main.app)


def _rows(tmp_path, sql, *args):
    conn = sqlite3.connect(tmp_path / "test.db")
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def _response(timestamp="2026-05-27T10:00:00", model="m1"):
    return {
        "findings": [], "not_assessable": [], "summary": "ok", "model_used": model,
        "tokens": {"prompt": 1, "completion": 1, "total": 2}, "sources_used": ["commits"],
        "repo_analyzed": "/tmp/x", "timestamp": timestamp,
    }


def test_default_db_path_is_relative_to_code(monkeypatch):
    monkeypatch.delenv("TID_DB_PATH", raising=False)
    expected = Path(db.__file__).resolve().parent.parent / "data" / "tid.db"
    assert db.db_path() == expected


# --- tareas ---------------------------------------------------------------------------


def test_task_get_put(client):
    assert client.get(f"/api/tasks/{TASK}").status_code == 404
    r = client.put(f"/api/tasks/{TASK}", json={"start_date": "2026-05-01", "end_date": ""})
    assert r.status_code == 200
    assert client.get(f"/api/tasks/{TASK}").json() == {
        "id": TASK, "start_date": "2026-05-01", "end_date": None, "groups": [],
    }
    # El PUT reemplaza ambas fechas.
    client.put(f"/api/tasks/{TASK}", json={"end_date": "2026-05-30"})
    assert client.get(f"/api/tasks/{TASK}").json()["start_date"] is None


def test_task_rejects_bad_date(client):
    assert client.put(f"/api/tasks/{TASK}", json={"end_date": "30-05-2026"}).status_code == 422


def test_list_tasks(client):
    assert client.get("/api/tasks").json() == []
    client.put(f"/api/tasks/{TASK}", json={})
    _put_rubric(client, "/api/tasks/UAICL/tarea03/rubric", "A")
    assert client.get("/api/tasks").json() == [TASK, "UAICL/tarea03"]


def test_put_groups_creates_task_and_is_idempotent(client):
    body = {"groups": [{"url": URL_A, "name": "ana"}, {"url": URL_B, "name": "beto"}]}
    r = client.put(f"/api/tasks/{TASK}/groups", json=body)
    assert r.status_code == 200
    assert r.json()["groups"] == body["groups"]
    again = client.put(f"/api/tasks/{TASK}/groups", json={"groups": [body["groups"][0]]})
    assert again.json()["groups"] == body["groups"]  # no duplica ni quita


def test_put_groups_keeps_task_dates(client):
    client.put(f"/api/tasks/{TASK}", json={"start_date": "2026-05-01"})
    r = client.put(f"/api/tasks/{TASK}/groups", json={"groups": [{"url": URL_A, "name": "ana"}]})
    assert r.json()["start_date"] == "2026-05-01"


def test_put_groups_conflict_when_group_in_other_task(client):
    client.put(f"/api/tasks/{TASK}/groups", json={"groups": [{"url": URL_A, "name": "ana"}]})
    r = client.put(
        "/api/tasks/UAICL/otra/groups",
        json={"groups": [{"url": URL_B, "name": "beto"}, {"url": URL_A, "name": "ana"}]},
    )
    assert r.status_code == 409
    assert URL_A in r.json()["detail"]
    assert client.get("/api/tasks/UAICL/otra").status_code == 404  # nada se agregó


def test_put_groups_rejects_blank(client):
    r = client.put(f"/api/tasks/{TASK}/groups", json={"groups": [{"url": URL_A, "name": " "}]})
    assert r.status_code == 422


# --- rúbricas -------------------------------------------------------------------------


def test_rubric_versions_are_never_overwritten(client, tmp_path):
    assert client.get(f"/api/tasks/{TASK}/rubric").status_code == 404
    v1 = _put_rubric(client, f"/api/tasks/{TASK}/rubric", "A").json()
    v2 = _put_rubric(client, f"/api/tasks/{TASK}/rubric", "B").json()
    assert (v1["version"], v2["version"]) == (1, 2)
    assert client.get(f"/api/tasks/{TASK}/rubric").json()["content"] == "B"
    assert _rows(tmp_path, "SELECT version, content FROM rubrics ORDER BY version") == [
        (1, "A"), (2, "B"),
    ]
    assert datetime.fromisoformat(v1["created_at"]).tzinfo is not None


def test_same_rubric_does_not_create_version(client):
    _put_rubric(client, f"/api/tasks/{TASK}/rubric", "A")
    again = _put_rubric(client, f"/api/tasks/{TASK}/rubric", "A").json()
    assert again["version"] == 1


def test_blank_rubric_rejected(client):
    assert _put_rubric(client, f"/api/tasks/{TASK}/rubric", "  ").status_code == 422


# --- análisis -------------------------------------------------------------------------


def test_analyses_most_recent_first_across_offsets(client):
    stamps = ("2026-05-27T10:00:00-04:00", "2026-05-27T13:00:00-04:00", "2026-05-27T12:00:00+00:00")
    for ts in stamps:
        repository.save_analysis(
            task_id=TASK, group_url=URL_A, rubric_version=None, rubric_state="none", model="m",
            head_commit=None, created_at=ts, result={},
        )
    got = [a["created_at"] for a in client.get("/api/analyses", params={"group_url": URL_A}).json()]
    # Instantes reales: 13:00-04:00 = 17:00Z, 10:00-04:00 = 14:00Z, 12:00+00:00 = 12:00Z.
    assert got == [
        "2026-05-27T17:00:00.000000+00:00",
        "2026-05-27T14:00:00.000000+00:00",
        "2026-05-27T12:00:00.000000+00:00",
    ]


def test_created_at_is_stored_in_utc(client):
    rubric = _put_rubric(client, f"/api/tasks/{TASK}/rubric", "A").json()
    assert rubric["created_at"].endswith("+00:00")
    assert datetime.fromisoformat(rubric["created_at"]).utcoffset() == timedelta(0)


def test_analyses_empty_for_unknown_group(client):
    assert client.get("/api/analyses", params={"group_url": URL_A}).json() == []


# --- /api/analyze ---------------------------------------------------------------------


@pytest.fixture
def analyze_env(client, monkeypatch, tmp_path):
    t = lambda h, m: datetime(2026, 5, 27, h, m, tzinfo=timezone(timedelta(hours=-4)))
    commits = [
        {"hash": "aaaaaaa", "full_hash": "a" * 40, "author": "ana", "moment": t(9, 0),
         "date": "d", "message": "m", "merge": False, "files": [], "stats": {}},
        {"hash": "bbbbbbb", "full_hash": "b" * 40, "author": "ana", "moment": t(11, 0),
         "date": "d", "message": "m", "merge": False, "files": [], "stats": {}},
        {"hash": "ccccccc", "full_hash": "c" * 40, "author": "ana", "moment": t(10, 0),
         "date": "d", "message": "m", "merge": False, "files": [], "stats": {}},
    ]
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    monkeypatch.setattr(main, "_resolve_repo", lambda *_: repo)
    monkeypatch.setattr(main.git_analyzer, "extract_commits", lambda _p: commits)
    monkeypatch.setattr(main.git_analyzer, "format_commits_for_prompt", lambda c: "x")
    monkeypatch.setattr(main.alert_checks, "bitacora_commits", lambda c, *a: [])
    result = llm.AnalysisResult("", "fallback/model:free", 1, 2, 3)
    monkeypatch.setattr(
        llm, "analyze_structured",
        lambda *_, **__: ({"findings": [], "not_assessable": [], "summary": "s"}, result),
    )


def _analyze(client, **extra):
    body = {"repo_url": URL_A, **extra}
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_analyze_saves_model_head_commit_and_tz_timestamp(client, analyze_env):
    _put_rubric(client, f"/api/tasks/{TASK}/rubric", "Criterio  1\nCriterio 2")
    data = _analyze(client, task_id=TASK, rubric="Criterio 1 Criterio 2")  # respaldo por texto
    saved = client.get("/api/analyses", params={"group_url": URL_A}).json()
    assert len(saved) == 1
    row = saved[0]
    assert row["model"] == "fallback/model:free"
    assert row["head_commit"] == "b" * 40  # el de la hora más tardía, no el último de la lista
    assert row["rubric_version"] == 1
    # Mismo instante que la respuesta, guardado en UTC.
    assert datetime.fromisoformat(row["created_at"]) == datetime.fromisoformat(data["timestamp"])
    assert row["created_at"].endswith("+00:00")
    assert row["result"]["summary"] == "s"


def test_analyze_explicit_rubric_version_wins(client, analyze_env):
    _put_rubric(client, f"/api/tasks/{TASK}/rubric", "A")
    _put_rubric(client, f"/api/tasks/{TASK}/rubric", "B")
    _analyze(client, task_id=TASK, rubric="B", rubric_version=1)
    assert client.get("/api/analyses", params={"group_url": URL_A}).json()[0]["rubric_version"] == 1


def test_analyze_unknown_rubric_version_is_400_before_llm(client, analyze_env):
    r = client.post("/api/analyze", json={"repo_url": URL_A, "task_id": TASK, "rubric_version": 9})
    assert r.status_code == 400


def test_analyze_without_task_id_saves_nothing(client, analyze_env, tmp_path):
    with db.connect():  # crea la base y las tablas antes de analizar
        pass
    _analyze(client)
    assert _rows(tmp_path, "SELECT COUNT(*) FROM analyses") == [(0,)]


def test_analyze_response_survives_db_failure(client, analyze_env, monkeypatch):
    def boom(**_):
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(main.repository, "save_analysis", boom)
    assert _analyze(client, task_id=TASK)["summary"] == "s"


# --- /api/import ----------------------------------------------------------------------

PAYLOAD = {
    "tasks": {
        TASK: {
            "rubric": "R2", "startDate": "2026-05-01", "endDate": "",
            "groups": [{"url": URL_A, "name": "ana"}, {"url": URL_B, "name": "beto"}],
            "lastGroupUrl": URL_A,
        }
    },
    "analyses": {
        URL_A: {"data": _response("2026-05-27T10:00:00"), "rubric": "R1"},
        URL_B: {"data": _response("2026-05-28T10:00:00", "m2"), "rubric": None},
        "https://github.com/otro/repo": {"data": _response(), "rubric": None},
    },
}


def test_import_inserts_and_is_idempotent(client, tmp_path):
    first = client.post("/api/import", json=PAYLOAD).json()
    assert first == {
        "tasks": 1, "rubrics": 2, "groups": 2, "analyses": 2,
        "analyses_skipped_duplicate": 0,
        "analyses_skipped_unknown_group": ["https://github.com/otro/repo"],
    }
    second = client.post("/api/import", json=PAYLOAD).json()
    assert second["tasks"] == second["rubrics"] == second["groups"] == second["analyses"] == 0
    assert second["analyses_skipped_duplicate"] == 2

    # La vigente es la de la tarea (R2); la que usó el análisis antiguo quedó como v1.
    assert client.get(f"/api/tasks/{TASK}/rubric").json()["content"] == "R2"
    a = client.get("/api/analyses", params={"group_url": URL_A}).json()[0]
    assert (a["rubric_version"], a["head_commit"], a["model"]) == (1, None, "m1")
    b = client.get("/api/analyses", params={"group_url": URL_B}).json()[0]
    assert b["rubric_version"] is None
    assert b["created_at"].endswith("+00:00")  # el timestamp naive quedó en UTC
    assert client.get(f"/api/tasks/{TASK}").json()["groups"] == [
        {"url": URL_A, "name": "ana"}, {"url": URL_B, "name": "beto"},
    ]


def test_import_does_not_overwrite_existing_dates_or_duplicate_rubric(client):
    client.put(f"/api/tasks/{TASK}", json={"end_date": "2026-06-01"})
    _put_rubric(client, f"/api/tasks/{TASK}/rubric", "R2")
    out = client.post("/api/import", json=PAYLOAD).json()
    assert out["tasks"] == 0 and out["rubrics"] == 1  # solo R1 es nueva
    task = client.get(f"/api/tasks/{TASK}").json()
    assert (task["start_date"], task["end_date"]) == ("2026-05-01", "2026-06-01")


def test_import_group_url_belongs_to_one_task(client):
    client.post("/api/import", json=PAYLOAD)
    other = {"tasks": {"UAICL/otra": {"groups": [{"url": URL_A, "name": "x"}]}}}
    assert client.post("/api/import", json=other).json()["groups"] == 0


def test_import_detects_same_instant_in_different_zones(client):
    def payload(ts):
        return {
            "tasks": {TASK: {"groups": [{"url": URL_A, "name": "ana"}]}},
            "analyses": {URL_A: {"data": _response(ts), "rubric": None}},
        }

    assert client.post("/api/import", json=payload("2026-05-27T10:00:00-04:00")).json()["analyses"] == 1
    again = client.post("/api/import", json=payload("2026-05-27T14:00:00+00:00")).json()
    assert again["analyses"] == 0 and again["analyses_skipped_duplicate"] == 1
    assert len(client.get("/api/analyses", params={"group_url": URL_A}).json()) == 1
