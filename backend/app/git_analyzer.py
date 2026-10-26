"""
Extracción de metadatos de commits con PyDriller.

Basado en la lógica de scripts/test_llm_repo_real.py.
"""

import re
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydriller import Repository
from pydriller.domain.commit import ModificationType

from app.config import is_excluded_author

_repo_locks: dict[str, threading.Lock] = {}
_repo_locks_guard = threading.Lock()


def _traverse(repo_path: str, **kwargs):
    """`Repository(...).traverse_commits()` con la apertura del repo bajo un candado por ruta.

    Al abrir un repo PyDriller escribe `.git/config`; dos peticiones simultáneas al mismo repo
    (p. ej. el panel de commit, que en desarrollo se monta dos veces) chocaban con el candado de
    git y una respondía 500. Solo la apertura va serializada: el recorrido sigue en paralelo."""
    with _repo_locks_guard:
        lock = _repo_locks.setdefault(str(Path(repo_path).resolve()), threading.Lock())
    commits = Repository(repo_path, **kwargs).traverse_commits()
    with lock:
        try:
            first = next(commits)  # aquí se abre el repo
        except StopIteration:
            return
    yield first
    yield from commits


_HUNK_HEADER_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")

_CHANGE_TYPE_MAP = {
    ModificationType.ADD: "added",
    ModificationType.DELETE: "deleted",
    ModificationType.RENAME: "renamed",
}


# Las fechas de la tarea (inicio 00:00 / entrega 23:59) se interpretan en hora
# de Chile, así que los commits se expresan en esa misma zona antes de compararlos.
TASK_TZ = ZoneInfo("America/Santiago")


def to_task_tz(moment: datetime) -> datetime:
    """Convierte la fecha (con zona horaria) de un commit a hora de Chile.
    Sin zona horaria se asume que ya está en hora de Chile."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=TASK_TZ)
    return moment.astimezone(TASK_TZ)


class CommitNotFoundError(Exception):
    def __init__(self, commit_hash: str):
        self.commit_hash = commit_hash


def compute_commit_stats(files: list[dict]) -> dict:
    """Cantidades por commit (archivos por tipo de cambio y líneas), para que el LLM no las cuente."""
    return {
        "files": len(files),
        "added_files": sum(f["change"] == "added" for f in files),
        "modified_files": sum(f["change"] == "modified" for f in files),
        "deleted_files": sum(f["change"] == "deleted" for f in files),
        "renamed_files": sum(f["change"] == "renamed" for f in files),
        "insertions": sum(f["added"] or 0 for f in files),
        "deletions": sum(f["deleted"] or 0 for f in files),
    }


def extract_commits(repo_path: str) -> list[dict]:
    """Recorre todos los commits del repo y devuelve sus metadatos."""
    commits = []
    for commit in _traverse(repo_path):
        commits.append(
            {
                "hash": commit.hash[:7],
                "full_hash": commit.hash,
                "author": commit.author.name,
                "date": to_task_tz(commit.author_date).strftime("%Y-%m-%d %H:%M %z"),
                "moment": to_task_tz(commit.author_date),
                "message": commit.msg.strip().replace("\n", " "),
                "merge": commit.merge,
                "files": [
                    {
                        "filename": modified_file.filename,
                        "added": modified_file.added_lines,
                        "deleted": modified_file.deleted_lines,
                        "change": _CHANGE_TYPE_MAP.get(modified_file.change_type, "modified"),
                        "path": modified_file.new_path or modified_file.old_path,
                    }
                    for modified_file in commit.modified_files
                ],
            }
        )
        commits[-1]["stats"] = compute_commit_stats(commits[-1]["files"])
    return commits


def _parse_diff_lines(diff_text: str) -> list[dict]:
    """Convierte un diff unificado de git en líneas tipadas (added/removed/context)
    con sus números de línea. PyDriller no expone esto directamente: su
    `diff_parsed` solo trae added/deleted, sin las líneas de contexto que
    necesitamos para orientar visualmente al usuario."""
    lines = []
    old_line = new_line = 0
    for raw in diff_text.splitlines():
        if not raw:
            continue
        header_match = _HUNK_HEADER_RE.match(raw)
        if header_match:
            old_line = int(header_match.group(1))
            new_line = int(header_match.group(2))
            continue
        if raw.startswith("\\"):
            # "\ No newline at end of file"
            continue

        prefix, content = raw[0], raw[1:]
        if prefix == "+":
            lines.append({"type": "added", "content": content, "new_line_number": new_line})
            new_line += 1
        elif prefix == "-":
            lines.append({"type": "removed", "content": content, "old_line_number": old_line})
            old_line += 1
        else:
            lines.append(
                {
                    "type": "context",
                    "content": content,
                    "old_line_number": old_line,
                    "new_line_number": new_line,
                }
            )
            old_line += 1
            new_line += 1
    return lines


def get_commit_diff(repo_path: str, commit_hash: str) -> dict:
    """Extrae un commit puntual (por hash) con el diff de cada archivo modificado."""
    try:
        commits = list(_traverse(repo_path, single=commit_hash))
    except Exception as exc:
        # Según el largo del hash, git/PyDriller informan un commit inexistente de dos formas.
        if "does not exist" in str(exc) or "could not be resolved" in str(exc):
            raise CommitNotFoundError(commit_hash) from exc
        raise

    if not commits:
        raise CommitNotFoundError(commit_hash)

    commit = commits[0]

    files = []
    for modified_file in commit.modified_files:
        filename = modified_file.filename
        change_type = _CHANGE_TYPE_MAP.get(modified_file.change_type, "modified")
        is_binary = modified_file.diff.strip().startswith("Binary files")

        files.append(
            {
                "filename": filename,
                "change_type": change_type,
                "is_binary": is_binary,
                "lines": [] if is_binary else _parse_diff_lines(modified_file.diff),
            }
        )

    return {
        "hash": commit.hash,
        "message_title": commit.msg.strip().split("\n", 1)[0],
        "message": commit.msg.strip(),
        "author": commit.author.name,
        "date": commit.author_date.isoformat(),
        "files": files,
    }


def _split_commit_message(msg: str) -> tuple[str, str]:
    """Separa el título (primera línea) del cuerpo del mensaje de commit."""
    parts = msg.strip().split("\n", 1)
    title = parts[0].strip()
    body = parts[1].strip() if len(parts) > 1 else ""
    return title, body


def _file_extension(filename: str) -> str:
    """Extensión del archivo en minúscula sin el punto; "other" si no tiene."""
    return Path(filename).suffix.lstrip(".").lower() or "other"


def build_commits_data(repo_path: str) -> dict:
    """Agrupa los commits por autor y día, en el mismo formato que el
    commits.json que genera RepoSense (ver frontend/src/types/zod/commits-type.ts),
    para que el ramp chart del frontend de triangulación lo consuma sin cambios.

    authorFileTypeContributionMap y authorContributionVariance se devuelven
    vacíos: el frontend los tipa como Record<string, unknown> y no los usa,
    y replicar los valores reales de RepoSense implicaría su motor de
    authorship/blame, que no es lo que hace este endpoint.
    """
    daily_map: dict[str, dict[str, dict]] = {}

    for commit in _traverse(repo_path):
        author = commit.author.name
        if is_excluded_author(author):
            continue

        moment = to_task_tz(commit.author_date)
        date_key = moment.strftime("%Y-%m-%dT00:00:00")
        title, body = _split_commit_message(commit.msg)

        file_types: dict[str, dict[str, int]] = {}
        for modified_file in commit.modified_files:
            insertions = modified_file.added_lines or 0
            deletions = modified_file.deleted_lines or 0
            if insertions == 0 and deletions == 0:
                continue  # binario u otro cambio sin líneas (ej. solo permisos)

            ext = _file_extension(modified_file.filename)
            entry = file_types.setdefault(ext, {"insertions": 0, "deletions": 0})
            entry["insertions"] += insertions
            entry["deletions"] += deletions

        commit_result = {
            "hash": commit.hash,
            "isMergeCommit": commit.merge,
            "authoredAt": moment.isoformat(timespec="seconds"),
            "messageTitle": title,
            "messageBody": body,
            "fileTypesAndContributionMap": file_types,
        }

        author_days = daily_map.setdefault(author, {})
        day_entry = author_days.setdefault(date_key, {"date": date_key, "commitResults": []})
        day_entry["commitResults"].append(commit_result)

    author_daily_contributions_map = {
        author: list(days.values()) for author, days in daily_map.items()
    }
    author_display_name_map = {author: author for author in author_daily_contributions_map}

    return {
        "authorDailyContributionsMap": author_daily_contributions_map,
        "authorFileTypeContributionMap": {},
        "authorContributionVariance": {},
        "authorDisplayNameMap": author_display_name_map,
    }


def format_commits_for_prompt(commits: list[dict]) -> str:
    """Convierte la lista de commits en el bloque de texto legible que espera el LLM."""
    lines = []
    for commit in commits:
        lines.append(
            f"- {commit['hash']} | {commit['author']} | "
            f"{commit['date']} | \"{commit['message']}\""
        )
        st = commit["stats"]
        renamed = f", {st['renamed_files']} renombrados" if st["renamed_files"] else ""
        lines.append(
            f"    Cantidades: {st['files']} archivos ({st['added_files']} agregados, "
            f"{st['modified_files']} modificados, {st['deleted_files']} eliminados{renamed}); "
            f"líneas: +{st['insertions']} -{st['deletions']}"
        )
        for file in commit["files"]:
            lines.append(
                f"    · {file['filename']} (+{file['added']} -{file['deleted']})"
            )
    return "\n".join(lines)
