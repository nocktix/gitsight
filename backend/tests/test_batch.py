import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import batch, main

ORG = "UAICL"


def _git(path: Path, *args: str):
    subprocess.run(
        ["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@t", *args],
        check=True, capture_output=True,
    )


def _repo(parent: Path, folder: str, commits: int = 1, origin: str | None = "auto") -> Path:
    path = parent / folder
    path.mkdir(parents=True)
    _git(path, "init", "-q")
    for i in range(commits):
        (path / f"f{i}.txt").write_text(str(i))
        _git(path, "add", ".")
        _git(path, "commit", "-q", "-m", f"c{i}")
    if origin == "auto":
        origin = f"https://github.com/{ORG}/{folder}"
    if origin:
        _git(path, "remote", "add", "origin", origin)
    return path


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "test.db"))
    return TestClient(main.app)


def _scan(client, folder):
    return client.post("/api/batch/scan", json={"folder": str(folder)})


def _rows(tmp_path, sql, *args):
    conn = sqlite3.connect(tmp_path / "test.db")
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def _download(tmp_path, name="d1"):
    root = tmp_path / name
    root.mkdir()
    (root / "scores.csv").write_text("user,score\n")
    _repo(root, "classroom50-tarea01-ana", commits=2)
    _repo(root, "classroom50-tarea01-beto-gomez", commits=3)
    (root / "sin-git").mkdir()
    return root


def test_common_prefix_and_group_names():
    names = ["c50-tarea01-ana", "c50-tarea01-beto-gomez"]
    prefix = batch.common_prefix(names)
    assert prefix == "c50-tarea01"
    assert [batch.group_name(n, prefix) for n in names] == ["ana", "beto-gomez"]


def test_common_prefix_edge_cases():
    assert batch.common_prefix(["t-a"]) == "t"  # un solo repo: se quita el último segmento
    assert batch.common_prefix(["tarea"]) == "tarea"
    assert batch.common_prefix(["x-ana", "x-ana-2"]) == "x"  # el grupo conserva al menos un segmento
    assert batch.common_prefix(["a-b", "c-d"]) == ""


def test_normalize_origin_drops_credentials_and_git_suffix():
    want = "https://github.com/UAICL/r"
    for raw in (
        "https://github.com/UAICL/r.git",
        "https://x-access-token:SECRETO@github.com/UAICL/r",
        "git@github.com:UAICL/r.git",
    ):
        assert batch.normalize_origin(raw) == want
    assert batch.normalize_origin("https://gitlab.com/UAICL/r") is None
    assert batch.normalize_origin(None) is None


def test_scan_lists_repos_and_ignores_scores_and_folders_without_git(client, tmp_path):
    res = _scan(client, _download(tmp_path))
    assert res.status_code == 200
    body = res.json()
    assert body["task_id"] == f"{ORG}/classroom50-tarea01"
    assert body["warnings"] == []
    assert [(g["name"], g["commits"]) for g in body["groups"]] == [("ana", 2), ("beto-gomez", 3)]
    assert body["groups"][0]["url"] == f"https://github.com/{ORG}/classroom50-tarea01-ana"
    assert all(g["has_origin"] for g in body["groups"])


def test_scan_registers_groups_with_local_path(client, tmp_path):
    root = _download(tmp_path)
    _scan(client, root)
    rows = _rows(tmp_path, "SELECT url, task_id, name, local_path FROM groups ORDER BY name")
    assert rows[0] == (
        f"https://github.com/{ORG}/classroom50-tarea01-ana",
        f"{ORG}/classroom50-tarea01", "ana", str((root / "classroom50-tarea01-ana").resolve()),
    )
    assert len(rows) == 2


def test_rescan_from_newer_download_updates_path_and_keeps_history(client, tmp_path):
    first, second = _download(tmp_path, "d1"), _download(tmp_path, "d2")
    task = f"{ORG}/classroom50-tarea01"
    url = f"https://github.com/{ORG}/classroom50-tarea01-ana"
    assert _scan(client, first).status_code == 200
    conn = sqlite3.connect(tmp_path / "test.db")
    conn.execute(
        "INSERT INTO analyses (task_id, group_url, rubric_state, model, created_at, result_json) "
        "VALUES (?, ?, 'none', 'm', '2026-05-01T00:00:00.000000+00:00', '{}')", (task, url),
    )
    conn.commit()
    conn.close()

    res = _scan(client, second)

    assert res.status_code == 200
    rows = _rows(tmp_path, "SELECT url, local_path FROM groups WHERE name = 'ana'")
    assert rows == [(url, str((second / "classroom50-tarea01-ana").resolve()))]
    assert _rows(tmp_path, "SELECT COUNT(*) FROM groups") == [(2,)]
    assert _rows(tmp_path, "SELECT COUNT(*) FROM analyses WHERE group_url = ?", url) == [(1,)]
    assert client.get("/api/analyses", params={"group_url": url}).json()[0]["task_id"] == task


def test_group_opened_by_url_before_is_the_same_group_when_scanned(client, tmp_path):
    task = f"{ORG}/classroom50-tarea01"
    url = f"https://github.com/{ORG}/classroom50-tarea01-ana"
    client.put(f"/api/tasks/{task}/groups", json={"groups": [{"url": url, "name": "ana"}]})
    client.put(f"/api/tasks/{task}", json={"start_date": "2026-05-01", "end_date": "2026-05-20"})

    res = _scan(client, _download(tmp_path))

    assert res.status_code == 200
    assert _rows(tmp_path, "SELECT COUNT(*) FROM groups WHERE url = ?", url) == [(1,)]
    assert client.get(f"/api/tasks/{task}").json()["start_date"] == "2026-05-01"
    assert client.get(f"/api/tasks/{task}").json()["groups"][0]["url"] == url


def test_repo_without_origin_uses_path_as_key_and_local_task_with_warning(client, tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _repo(root, "c50-t1-ana")
    _repo(root, "c50-t1-beto", origin=None)

    body = _scan(client, root).json()

    assert body["task_id"] == "local/c50-t1"
    assert "c50-t1-beto" in body["warnings"][0]
    by_name = {g["name"]: g for g in body["groups"]}
    assert by_name["beto"]["url"] == str((root / "c50-t1-beto").resolve())
    assert by_name["beto"]["has_origin"] is False
    assert by_name["ana"]["has_origin"] is True


def test_different_owners_fall_back_to_local_task(client, tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _repo(root, "c50-t1-ana", origin="https://github.com/OrgA/c50-t1-ana")
    _repo(root, "c50-t1-beto", origin="https://github.com/OrgB/c50-t1-beto")
    body = _scan(client, root).json()
    assert body["task_id"] == "local/c50-t1" and body["warnings"]


def test_scan_errors(client, tmp_path):
    assert _scan(client, tmp_path / "no-existe").status_code == 400
    (tmp_path / "vacia").mkdir()
    assert _scan(client, tmp_path / "vacia").status_code == 400


def test_group_in_another_task_is_a_conflict(client, tmp_path):
    url = f"https://github.com/{ORG}/classroom50-tarea01-ana"
    client.put("/api/tasks/UAICL/otra/groups", json={"groups": [{"url": url, "name": "ana"}]})
    assert _scan(client, _download(tmp_path)).status_code == 409


def test_scanned_url_resolves_to_local_folder_and_falls_back_when_missing(client, tmp_path, monkeypatch):
    root = _download(tmp_path)
    _scan(client, root)
    url = f"https://github.com/{ORG}/classroom50-tarea01-ana"
    cloned = []
    monkeypatch.setattr(main.repo_cache, "get_or_clone", lambda u: cloned.append(u) or tmp_path)

    assert main._scanned_folder(url) == (root / "classroom50-tarea01-ana").resolve()
    assert main._scanned_folder("https://github.com/UAICL/otro") is None

    (root / "classroom50-tarea01-ana" / ".git").rename(root / "x")  # la carpeta ya no es un repo
    assert main._scanned_folder(url) is None


def test_migration_adds_local_path_to_an_existing_groups_table(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, start_date TEXT, end_date TEXT);"
        "CREATE TABLE groups (url TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL);"
        "INSERT INTO tasks (id) VALUES ('UAICL/t'); "
        "INSERT INTO groups VALUES ('https://github.com/UAICL/t-ana', 'UAICL/t', 'ana');"
    )
    old.commit()
    old.close()
    monkeypatch.setenv("TID_DB_PATH", str(path))
    from app import db, repository

    db._initialized.discard(str(path))
    assert repository.get_local_path("https://github.com/UAICL/t-ana") is None
    assert repository.add_groups("UAICL/t", [
        {"url": "https://github.com/UAICL/t-ana", "name": "ana", "local_path": "/d/t-ana"}
    ]) == []
    assert repository.get_local_path("https://github.com/UAICL/t-ana") == "/d/t-ana"
    assert list(tmp_path.glob("old.db.bak-*"))  # la migración respalda la base antes de tocarla


# --- marcador .classroom50.yaml ------------------------------------------------------------

# Forma que define el esquema oficial repo-config-v1: classroom y assignment en la raíz; el resto
# es opcional y puede traer claves anidadas (owner, source) con campos que se llaman parecido.
MARKER = """\
schema: classroom50/repo-config/v1
classroom: c50
assignment: tarea-01
secret: abc123
owner:
  username: ana-x
  id: 42
  accepted_at: 2026-05-01T10:00:00Z
source:
  owner: UAICL
  repo: plantilla
  branch: main
"""


def _marked(parent: Path, folder: str, marker: str | None = MARKER, name=".classroom50.yaml", **kw):
    path = _repo(parent, folder, **kw)
    if marker is not None:
        (path / name).write_text(marker)
    return path


def _prefix_of(root: Path):
    repos = batch.list_repos(str(root))
    return batch.resolve_prefix(repos)[0], {r.folder: batch.group_name(r.folder, batch.resolve_prefix(repos)[0]) for r in repos}


def test_marker_separates_users_that_share_their_first_segment(client, tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _marked(root, "c50-tarea-01-ana-x")
    _marked(root, "c50-tarea-01-ana-y")

    body = _scan(client, root).json()

    assert body["task_id"] == f"{ORG}/c50-tarea-01"
    assert [g["name"] for g in body["groups"]] == ["ana-x", "ana-y"]
    assert body["warnings"] == []


def test_without_marker_users_sharing_first_segment_collapse_into_the_prefix(tmp_path):
    # Límite conocido del respaldo: sin el marcador no hay cómo distinguir ana-x/ana-y del prefijo.
    root = tmp_path / "d"
    root.mkdir()
    _repo(root, "c50-tarea-01-ana-x")
    _repo(root, "c50-tarea-01-ana-y")
    prefix, groups = _prefix_of(root)
    assert prefix == "c50-tarea-01-ana" and list(groups.values()) == ["x", "y"]


@pytest.mark.parametrize(
    "text, expected",
    [
        (MARKER, "c50-tarea-01"),
        ("classroom: c50\nassignment: t1\n", "c50-t1"),
        ('classroom: "c50"   # el curso\nassignment: \'t1\'\n', "c50-t1"),
        ("classroom: c50\r\nassignment: t1\r\n", "c50-t1"),  # saltos de línea de Windows
        ("﻿classroom: c50\nassignment: t1\n", "c50-t1"),  # con BOM
        ("Classroom: c50\nASSIGNMENT: t1\n", "c50-t1"),  # claves en otra capitalización
        ("# generado\nassignment: t1\nextra: 1\nclassroom: c50\n", "c50-t1"),  # otro orden y claves extra
        ("classroom: c50\n", None),  # falta assignment
        ("classroom: c50\nassignment:\n", None),  # assignment vacío
        ("source:\n  classroom: c50\n  assignment: t1\n", None),  # anidado: no es de la raíz
        ("esto: [no es yaml\n\x00", None),
        ("", None),
    ],
)
def test_read_marker_prefix_is_tolerant(tmp_path, text, expected):
    (tmp_path / ".classroom50.yaml").write_text(text, encoding="utf-8")
    assert batch.read_marker_prefix(tmp_path) == expected


def test_read_marker_accepts_yml_extension_and_missing_file(tmp_path):
    assert batch.read_marker_prefix(tmp_path) is None
    (tmp_path / ".classroom50.yml").write_text("classroom: c50\nassignment: t1\n")
    assert batch.read_marker_prefix(tmp_path) == "c50-t1"


def test_marker_wins_over_common_prefix(tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _marked(root, "c50-tarea-01-ana", name=".classroom50.yml")
    _marked(root, "c50-tarea-01-beto")
    _marked(root, "c50-tarea-01-group-1")  # tarea en equipos
    prefix, groups = _prefix_of(root)
    assert prefix == "c50-tarea-01"
    assert set(groups.values()) == {"ana", "beto", "group-1"}


def test_repo_without_marker_still_gets_its_group_when_others_have_one(tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _marked(root, "c50-tarea-01-ana")
    _marked(root, "c50-tarea-01-beto", marker=None)
    assert _prefix_of(root)[1] == {"c50-tarea-01-ana": "ana", "c50-tarea-01-beto": "beto"}


def test_marker_that_does_not_match_the_folder_name_falls_back_to_common_prefix(tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _marked(root, "x-t2-ana")  # el marcador dice c50-tarea-01, pero la carpeta se llama otra cosa
    _marked(root, "x-t2-beto")
    assert _prefix_of(root)[0] == "x-t2"


def test_conflicting_markers_use_the_most_common_and_warn(client, tmp_path):
    root = tmp_path / "d"
    root.mkdir()
    _marked(root, "c50-tarea-01-ana")
    _marked(root, "c50-tarea-01-beto")
    _marked(root, "c50-tarea-02-carla", marker=MARKER.replace("tarea-01", "tarea-02"))

    body = _scan(client, root).json()

    assert body["task_id"] == f"{ORG}/c50-tarea-01"
    assert "c50-tarea-02" in body["warnings"][0]
    assert {g["name"] for g in body["groups"]} == {"ana", "beto", "c50-tarea-02-carla"}


def test_marker_matches_folder_names_ignoring_case(client, tmp_path):
    # El repo se llama en minúsculas, pero el marcador guarda classroom y assignment tal cual.
    root = tmp_path / "d"
    root.mkdir()
    marker = "classroom: POO-2026\nassignment: Tarea01\n"
    _marked(root, "poo-2026-tarea01-ana-x", marker=marker)
    _marked(root, "poo-2026-tarea01-ana-y", marker=marker)

    prefix, groups = _prefix_of(root)
    body = _scan(client, root).json()

    assert prefix == "poo-2026-tarea01"  # con la capitalización del nombre de la carpeta
    assert set(groups.values()) == {"ana-x", "ana-y"}
    assert body["task_id"] == f"{ORG}/poo-2026-tarea01"
    assert [g["name"] for g in body["groups"]] == ["ana-x", "ana-y"]
    assert body["warnings"] == []
