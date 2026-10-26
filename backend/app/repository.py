"""Acceso a datos de tareas, rúbricas, análisis y grupos."""

import json
import sqlite3

from app.db import connect, now_iso, to_iso_tz


def normalize_text(text: str) -> str:
    """Para comparar rúbricas: ignora diferencias de espacios y saltos de línea."""
    return " ".join(text.split())


# --- tareas ---------------------------------------------------------------------------


def ensure_task(conn: sqlite3.Connection, task_id: str) -> None:
    conn.execute("INSERT OR IGNORE INTO tasks (id) VALUES (?)", (task_id,))


def list_task_ids() -> list[str]:
    with connect() as conn:
        return [r["id"] for r in conn.execute("SELECT id FROM tasks ORDER BY rowid")]


def get_task(task_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            return None
        groups = conn.execute(
            "SELECT url, name FROM groups WHERE task_id = ? ORDER BY rowid", (task_id,)
        ).fetchall()
    return {
        "id": row["id"],
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "groups": [dict(g) for g in groups],
    }


def put_task(task_id: str, start_date: str | None, end_date: str | None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO tasks (id, start_date, end_date) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET start_date = excluded.start_date, "
            "end_date = excluded.end_date",
            (task_id, start_date, end_date),
        )


def add_groups(task_id: str, groups: list[dict]) -> list[str]:
    """Agrega los grupos a la tarea (la tarea se crea si no existe). Repetir un grupo ya
    guardado en esa tarea no hace nada. Devuelve las URL que pertenecen a otra tarea, que no
    se tocan; si hay alguna no se agrega ninguno."""
    with connect() as conn:
        urls = [g["url"] for g in groups]
        owners = {
            r["url"]: r["task_id"]
            for r in conn.execute(
                f"SELECT url, task_id FROM groups WHERE url IN ({','.join('?' * len(urls))})",
                urls,
            )
        } if urls else {}
        conflicts = [u for u, t in owners.items() if t != task_id]
        if conflicts:
            return conflicts
        ensure_task(conn, task_id)
        conn.executemany(
            "INSERT OR IGNORE INTO groups (url, task_id, name) VALUES (?, ?, ?)",
            [(g["url"], task_id, g["name"]) for g in groups],
        )
    return []


# --- rúbricas -------------------------------------------------------------------------

_RUBRIC_COLUMNS = "task_id, version, content, created_at, filename, note, active"


def _rubric_dict(row: sqlite3.Row) -> dict:
    return {**dict(row), "active": bool(row["active"])}


def get_current_rubric(task_id: str) -> dict | None:
    """La versión activa de la tarea (la que usan los análisis nuevos); None si no hay."""
    with connect() as conn:
        row = conn.execute(
            f"SELECT {_RUBRIC_COLUMNS} FROM rubrics WHERE task_id = ? AND active = 1", (task_id,)
        ).fetchone()
    return None if row is None else _rubric_dict(row)


def list_rubric_versions(task_id: str) -> list[dict]:
    """Todas las versiones de la tarea, la más reciente primero."""
    with connect() as conn:
        rows = conn.execute(
            f"SELECT {_RUBRIC_COLUMNS} FROM rubrics WHERE task_id = ? ORDER BY version DESC",
            (task_id,),
        ).fetchall()
    return [_rubric_dict(r) for r in rows]


def get_rubric_version(task_id: str, version: int) -> dict | None:
    with connect() as conn:
        row = conn.execute(
            f"SELECT {_RUBRIC_COLUMNS} FROM rubrics WHERE task_id = ? AND version = ?",
            (task_id, version),
        ).fetchone()
    return None if row is None else _rubric_dict(row)


def rubric_version_exists(task_id: str, version: int) -> bool:
    return get_rubric_version(task_id, version) is not None


def _set_active(conn: sqlite3.Connection, task_id: str, version: int) -> None:
    # Primero se apaga la activa: el índice único parcial no admite dos a la vez.
    conn.execute("UPDATE rubrics SET active = 0 WHERE task_id = ? AND active = 1", (task_id,))
    conn.execute("UPDATE rubrics SET active = 1 WHERE task_id = ? AND version = ?", (task_id, version))


def _insert_rubric(
    conn: sqlite3.Connection,
    task_id: str,
    content: str,
    *,
    filename: str | None = None,
    note: str | None = None,
    active: bool = False,
) -> dict:
    ensure_task(conn, task_id)
    last = conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM rubrics WHERE task_id = ?", (task_id,)
    ).fetchone()[0]
    created_at = now_iso()
    conn.execute(
        "INSERT INTO rubrics (task_id, version, content, created_at, filename, note, active) "
        "VALUES (?, ?, ?, ?, ?, ?, 0)",
        (task_id, last + 1, content, created_at, filename, note),
    )
    if active:
        _set_active(conn, task_id, last + 1)
    return {
        "task_id": task_id,
        "version": last + 1,
        "content": content,
        "created_at": created_at,
        "filename": filename,
        "note": note,
        "active": active,
    }


def create_rubric_version(
    task_id: str,
    content: str,
    *,
    filename: str | None = None,
    note: str | None = None,
    activate: bool = True,
) -> tuple[dict, bool]:
    """Sube una rúbrica como versión nueva, sin tocar las anteriores. Si el contenido es idéntico
    (sin contar espacios ni saltos de línea) al de CUALQUIER versión de la tarea no crea otra:
    devuelve esa versión y, con `activate`, la activa. Devuelve (versión, creada)."""
    with connect() as conn:
        existing = _find_rubric_version(conn, task_id, content)
        if existing is not None:
            if activate:
                _set_active(conn, task_id, existing)
            row = conn.execute(
                f"SELECT {_RUBRIC_COLUMNS} FROM rubrics WHERE task_id = ? AND version = ?",
                (task_id, existing),
            ).fetchone()
            return _rubric_dict(row), False
        return _insert_rubric(
            conn, task_id, content, filename=filename, note=note, active=activate
        ), True


def activate_rubric_version(task_id: str, version: int) -> dict | None:
    """Deja `version` como la activa de la tarea. None si no existe."""
    with connect() as conn:
        if conn.execute(
            "SELECT 1 FROM rubrics WHERE task_id = ? AND version = ?", (task_id, version)
        ).fetchone() is None:
            return None
        _set_active(conn, task_id, version)
        row = conn.execute(
            f"SELECT {_RUBRIC_COLUMNS} FROM rubrics WHERE task_id = ? AND version = ?",
            (task_id, version),
        ).fetchone()
    return _rubric_dict(row)


def _find_rubric_version(conn: sqlite3.Connection, task_id: str, content: str) -> int | None:
    """Versión más reciente cuyo texto coincide (sin considerar espacios ni saltos de línea)."""
    wanted = normalize_text(content)
    rows = conn.execute(
        "SELECT version, content FROM rubrics WHERE task_id = ? ORDER BY version DESC",
        (task_id,),
    ).fetchall()
    for row in rows:
        if normalize_text(row["content"]) == wanted:
            return row["version"]
    return None


def find_rubric_version(task_id: str, content: str) -> int | None:
    with connect() as conn:
        return _find_rubric_version(conn, task_id, content)


def _ensure_active(conn: sqlite3.Connection, task_id: str) -> None:
    """Si la tarea tiene versiones pero ninguna activa, activa la más reciente."""
    if conn.execute(
        "SELECT 1 FROM rubrics WHERE task_id = ? AND active = 1", (task_id,)
    ).fetchone() is None:
        row = conn.execute(
            "SELECT MAX(version) FROM rubrics WHERE task_id = ?", (task_id,)
        ).fetchone()
        if row[0] is not None:
            _set_active(conn, task_id, row[0])


# --- análisis -------------------------------------------------------------------------


def save_analysis(
    *,
    task_id: str,
    group_url: str,
    rubric_version: int | None,
    rubric_state: str,
    model: str,
    head_commit: str | None,
    created_at: str,
    result: dict,
) -> None:
    """`rubric_state`: 'version' (con `rubric_version`), 'none' (sin rúbrica) o 'unknown'."""
    with connect() as conn:
        ensure_task(conn, task_id)
        conn.execute(
            "INSERT OR IGNORE INTO analyses (task_id, group_url, rubric_version, rubric_state, "
            "model, head_commit, created_at, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                task_id,
                group_url,
                rubric_version,
                rubric_state,
                model,
                head_commit,
                to_iso_tz(created_at),
                json.dumps(result, ensure_ascii=False),
            ),
        )


def list_analyses(group_url: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM analyses WHERE group_url = ? "
            "ORDER BY created_at DESC, id DESC",
            (group_url,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "task_id": r["task_id"],
            "group_url": r["group_url"],
            "rubric_version": r["rubric_version"],
            "rubric_state": r["rubric_state"],
            "model": r["model"],
            "head_commit": r["head_commit"],
            "created_at": r["created_at"],
            "result": json.loads(r["result_json"]),
        }
        for r in rows
    ]


# --- importación desde localStorage ---------------------------------------------------


def import_data(tasks: dict[str, dict], analyses: dict[str, dict]) -> dict:
    """Inserta tareas, rúbricas, grupos y análisis de localStorage sin duplicar.

    `tasks`: {taskId: {rubric, startDate, endDate, groups: [{url, name}]}}
    `analyses`: {groupUrl: {data: <AnalyzeResponse>, rubric}}
    """
    counts = {
        "tasks": 0,
        "rubrics": 0,
        "groups": 0,
        "analyses": 0,
        "analyses_skipped_duplicate": 0,
        "analyses_skipped_unknown_group": [],
    }

    with connect() as conn:
        # url del grupo -> tarea, con lo que ya hay en la base y lo que trae el import.
        group_task = {
            r["url"]: r["task_id"] for r in conn.execute("SELECT url, task_id FROM groups")
        }

        for task_id, task in tasks.items():
            existing = conn.execute(
                "SELECT start_date, end_date FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            start, end = task.get("startDate") or None, task.get("endDate") or None
            if existing is None:
                conn.execute(
                    "INSERT INTO tasks (id, start_date, end_date) VALUES (?, ?, ?)",
                    (task_id, start, end),
                )
                counts["tasks"] += 1
            else:  # no se pisa lo que ya tiene valor
                conn.execute(
                    "UPDATE tasks SET start_date = ?, end_date = ? WHERE id = ?",
                    (existing["start_date"] or start, existing["end_date"] or end, task_id),
                )
            for group in task.get("groups", []):
                if group["url"] in group_task:
                    continue
                conn.execute(
                    "INSERT INTO groups (url, task_id, name) VALUES (?, ?, ?)",
                    (group["url"], task_id, group["name"]),
                )
                group_task[group["url"]] = task_id
                counts["groups"] += 1

        # Rúbricas. Primero las que usaron análisis antiguos y difieren de la vigente de la
        # tarea (más antiguas primero) y al final la vigente, para que quede como última versión.
        by_task: dict[str, list[tuple[str, str]]] = {}
        for url, item in analyses.items():
            task_id, rubric = group_task.get(url), item.get("rubric")
            if task_id and rubric and rubric.strip():
                stamp = to_iso_tz((item.get("data") or {}).get("timestamp"))
                by_task.setdefault(task_id, []).append((stamp, rubric))

        for task_id in set(by_task) | {t for t, v in tasks.items() if v.get("rubric")}:
            current = (tasks.get(task_id) or {}).get("rubric")
            current_norm = normalize_text(current) if current and current.strip() else None
            olders = sorted(by_task.get(task_id, []), key=lambda s: s[0])
            for _, rubric in olders:
                if normalize_text(rubric) == current_norm:
                    continue
                if _find_rubric_version(conn, task_id, rubric) is None:
                    _insert_rubric(conn, task_id, rubric)
                    counts["rubrics"] += 1
            if current_norm and _find_rubric_version(conn, task_id, current) is None:
                _insert_rubric(conn, task_id, current)
                counts["rubrics"] += 1

        for url, item in analyses.items():
            task_id = group_task.get(url)
            if task_id is None:
                counts["analyses_skipped_unknown_group"].append(url)
                continue
            data = item.get("data") or {}
            rubric = item.get("rubric")
            has_rubric = bool(rubric and rubric.strip())
            version = _find_rubric_version(conn, task_id, rubric) if has_rubric else None
            state = "version" if version is not None else ("unknown" if has_rubric else "none")
            cursor = conn.execute(
                "INSERT OR IGNORE INTO analyses (task_id, group_url, rubric_version, rubric_state, "
                "model, head_commit, created_at, result_json) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
                (
                    task_id,
                    url,
                    version,
                    state,
                    data.get("model_used") or "desconocido",
                    to_iso_tz(data.get("timestamp")),
                    json.dumps(data, ensure_ascii=False),
                ),
            )
            counts["analyses" if cursor.rowcount else "analyses_skipped_duplicate"] += 1

        for task_id in set(group_task.values()):
            _ensure_active(conn, task_id)

    return counts


# --- resúmenes de commit --------------------------------------------------------------


class AmbiguousCommitHashError(Exception):
    """Un hash corto coincide con más de un resumen guardado."""

    def __init__(self, prefix: str, matches: list[str]):
        super().__init__(prefix)
        self.prefix = prefix
        self.matches = matches


def _summary_row(row: sqlite3.Row) -> dict:
    return {
        **json.loads(row["result_json"]),
        "commit_hash": row["commit_hash"],
        "repo_url": row["repo_url"],
        "model": row["model"],
        "requested_model": row["requested_model"],
        "created_at": row["created_at"],
    }


def get_commit_summary(repo_url: str, commit_hash: str) -> dict | None:
    """Resumen guardado. `commit_hash` puede ser un prefijo (solo hexadecimal); si coincide con
    más de un commit guardado lanza AmbiguousCommitHashError en vez de elegir uno."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM commit_summaries WHERE repo_url = ? AND commit_hash LIKE ? "
            "ORDER BY commit_hash",
            (repo_url, commit_hash + "%"),
        ).fetchall()
    exact = [r for r in rows if r["commit_hash"] == commit_hash]
    if exact:
        return _summary_row(exact[0])
    if len(rows) > 1:
        raise AmbiguousCommitHashError(commit_hash, [r["commit_hash"] for r in rows])
    return _summary_row(rows[0]) if rows else None


def save_commit_summary(
    *,
    repo_url: str,
    commit_hash: str,
    model: str,
    result: dict,
    requested_model: str | None = None,
) -> str:
    """Guarda (o reemplaza) el resumen de un commit. `model` es el que respondió y
    `requested_model` el que pidió el evaluador (None = Automático). Devuelve el created_at."""
    created_at = now_iso()
    with connect() as conn:
        conn.execute(
            "INSERT INTO commit_summaries "
            "(repo_url, commit_hash, model, result_json, created_at, requested_model) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(repo_url, commit_hash) DO UPDATE SET model = excluded.model, "
            "result_json = excluded.result_json, created_at = excluded.created_at, "
            "requested_model = excluded.requested_model",
            (
                repo_url,
                commit_hash,
                model,
                json.dumps(result, ensure_ascii=False),
                created_at,
                requested_model,
            ),
        )
    return created_at
