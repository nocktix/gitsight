"""Conexión y esquema de la base SQLite (módulo estándar sqlite3, sin ORM)."""

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

# Relativa al código (no al directorio actual): así uvicorn puede lanzarse desde cualquier
# carpeta sin crear una segunda base. TID_DB_PATH la reemplaza (los tests usan una temporal).
logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "tid.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,   -- "owner/prefijo"
    start_date TEXT,               -- YYYY-MM-DD o NULL
    end_date   TEXT
);

CREATE TABLE IF NOT EXISTS groups (
    url     TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    name    TEXT NOT NULL
);

-- Las rúbricas nunca se sobrescriben: subir o editar crea una versión nueva. Una sola está
-- activa por tarea (la que usan los análisis nuevos de todos sus grupos).
CREATE TABLE IF NOT EXISTS rubrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL REFERENCES tasks(id),
    version    INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,      -- ISO 8601 en UTC (+00:00), ancho fijo
    filename   TEXT,               -- archivo original; NULL si se pegó el texto o es anterior
    note       TEXT,               -- nota opcional del evaluador
    active     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (task_id, version)
);

CREATE TABLE IF NOT EXISTS analyses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id        TEXT NOT NULL REFERENCES tasks(id),
    group_url      TEXT NOT NULL,
    rubric_version INTEGER,        -- NULL si no hay versión (ver rubric_state)
    rubric_state   TEXT,           -- 'version' | 'none' (sin rúbrica) | 'unknown' (usó una, no se sabe cuál)
    model          TEXT NOT NULL,
    head_commit    TEXT,           -- NULL en los análisis importados
    created_at     TEXT NOT NULL,  -- ISO 8601 en UTC (+00:00), ancho fijo
    result_json    TEXT NOT NULL,
    UNIQUE (group_url, created_at)
);
CREATE INDEX IF NOT EXISTS idx_analyses_group ON analyses (group_url);

-- Caché de los resúmenes de commit con LLM: un resumen por (repo, commit).
CREATE TABLE IF NOT EXISTS commit_summaries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_url    TEXT NOT NULL,     -- normalizada (ver commit_summary.normalize_repo_url)
    commit_hash TEXT NOT NULL,     -- hash completo
    model       TEXT NOT NULL,     -- modelo que realmente respondió
    result_json TEXT NOT NULL,
    created_at  TEXT NOT NULL,     -- ISO 8601 en UTC (+00:00), ancho fijo
    requested_model TEXT,          -- modelo pedido por el evaluador; NULL = Automático (o fila antigua)
    UNIQUE (repo_url, commit_hash)
);
"""

_initialized: set[str] = set()


def db_path() -> Path:
    return Path(os.environ.get("TID_DB_PATH") or DEFAULT_DB_PATH)


def _utc_iso(moment: datetime) -> str:
    # Ancho fijo (siempre con microsegundos) para que el orden por texto sea el orden cronológico.
    return moment.astimezone(timezone.utc).isoformat(timespec="microseconds")


def now_iso() -> str:
    """Ahora, en ISO 8601 UTC."""
    return _utc_iso(datetime.now(timezone.utc))


def to_iso_tz(value: str | None) -> str:
    """Normaliza un timestamp a ISO 8601 UTC. Un valor sin zona (los análisis antiguos) se
    interpreta como hora local de esta máquina; uno vacío o inválido, como ahora."""
    try:
        parsed = datetime.fromisoformat(value) if value else None
    except ValueError:
        parsed = None
    return now_iso() if parsed is None else _utc_iso(parsed)  # naive -> astimezone() usa la local


# Columnas agregadas después de crear las tablas: CREATE TABLE IF NOT EXISTS no las agrega.
_ADDED_COLUMNS = [
    ("commit_summaries", "requested_model", "TEXT"),
    ("rubrics", "filename", "TEXT"),
    ("rubrics", "note", "TEXT"),
    ("rubrics", "active", "INTEGER NOT NULL DEFAULT 0"),
    ("analyses", "rubric_state", "TEXT"),
]


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _rubric_state_of(version: int | None, result_json: str) -> str:
    """Estado de rúbrica de un análisis anterior a rubric_state. Nunca se inventa una versión:
    con versión guardada es 'version'; sin ella, 'none' solo si el resultado dice que no usó
    rúbrica, y 'unknown' si la usó o no hay forma de saberlo."""
    if version is not None:
        return "version"
    try:
        sources = json.loads(result_json).get("sources_used")
    except (ValueError, AttributeError):
        sources = None
    if isinstance(sources, list) and "rubric" not in sources:
        return "none"
    return "unknown"


def _pending_changes(conn: sqlite3.Connection) -> bool:
    """¿La migración va a modificar algo de una base existente? (columnas faltantes o filas por
    completar). Crear tablas nuevas no cuenta: no toca datos."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    for table, column, _ in _ADDED_COLUMNS:
        if table in tables and column not in _columns(conn, table):
            return True
    if "rubrics" in tables and "active" in _columns(conn, "rubrics"):
        if conn.execute(
            "SELECT 1 FROM rubrics r WHERE NOT EXISTS "
            "(SELECT 1 FROM rubrics a WHERE a.task_id = r.task_id AND a.active = 1) LIMIT 1"
        ).fetchone():
            return True
    if "analyses" in tables and "rubric_state" in _columns(conn, "analyses"):
        if conn.execute("SELECT 1 FROM analyses WHERE rubric_state IS NULL LIMIT 1").fetchone():
            return True
    return False


def _backup(conn: sqlite3.Connection, path: Path) -> Path:
    """Copia consistente de la base antes de migrarla: tid.db.bak-AAAA-MM-DD_HHMMSS."""
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    target = path.with_name(f"{path.name}.bak-{stamp}")
    n = 1
    while target.exists():
        target = path.with_name(f"{path.name}.bak-{stamp}-{n}")
        n += 1
    copy = sqlite3.connect(target)
    try:
        conn.backup(copy)
    finally:
        copy.close()
    return target


def _migrate(path: Path) -> None:
    """Crea o actualiza el esquema. En una base con datos, hace un respaldo antes de cambiar
    nada y solo si hay algo que cambiar (así ocurre una única vez)."""
    existed = path.exists() and path.stat().st_size > 0
    boot = sqlite3.connect(path)
    try:
        if existed and _pending_changes(boot):
            backup = _backup(boot, path)
            logger.warning("Migración de la base: respaldo guardado en %s", backup)
        boot.executescript(SCHEMA)
        for table, column, decl in _ADDED_COLUMNS:
            if column not in _columns(boot, table):
                boot.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        boot.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_rubrics_active ON rubrics (task_id) WHERE active = 1"
        )
        # La rúbrica que había en cada tarea (la de mayor versión, que era la vigente) queda activa.
        boot.execute(
            "UPDATE rubrics SET active = 1 WHERE version = "
            "(SELECT MAX(version) FROM rubrics r WHERE r.task_id = rubrics.task_id) "
            "AND NOT EXISTS (SELECT 1 FROM rubrics a WHERE a.task_id = rubrics.task_id AND a.active = 1)"
        )
        for row in boot.execute(
            "SELECT id, rubric_version, result_json FROM analyses WHERE rubric_state IS NULL"
        ).fetchall():
            boot.execute(
                "UPDATE analyses SET rubric_state = ? WHERE id = ?",
                (_rubric_state_of(row[1], row[2]), row[0]),
            )
        boot.commit()
    finally:
        boot.close()


@contextmanager
def connect():
    """Conexión con commit al salir sin error (rollback si hubo excepción)."""
    path = db_path()
    if str(path) not in _initialized:
        path.parent.mkdir(parents=True, exist_ok=True)
        _migrate(path)
        _initialized.add(str(path))

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()
