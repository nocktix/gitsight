"""Análisis por lote: lee una carpeta descargada con `gh teacher download` (una subcarpeta por
repo, <classroom>-<tarea>-<usuario>) y deduce la tarea, los grupos y la URL de cada repo."""

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

_GIT_TIMEOUT_SECONDS = 15
_GITHUB_ORIGIN = re.compile(
    r"^(?:https?://(?:[^/@]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)"
    r"([\w.-]+)/([\w.-]+?)(?:\.git)?/?$"
)
LOCAL_OWNER = "local"


class BatchError(Exception):
    """La carpeta no se puede escanear; el mensaje se muestra tal cual al evaluador."""


@dataclass
class ScannedRepo:
    folder: str  # nombre de la subcarpeta
    path: str  # ruta absoluta
    origin_url: str | None  # https://github.com/<owner>/<repo>, o None si no hay origin
    commits: int | None  # None si no se pudieron contar (repo dañado o vacío)
    marker_prefix: str | None = None  # "<classroom>-<tarea>" según .classroom50.yaml, si existe


def _git(path: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args],
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def normalize_origin(raw: str | None) -> str | None:
    """URL canónica de GitHub (sin credenciales ni .git), la misma que usa el flujo por URL."""
    match = _GITHUB_ORIGIN.match((raw or "").strip())
    return f"https://github.com/{match[1]}/{match[2]}" if match else None


def count_commits(path: Path) -> int | None:
    out = _git(path, "rev-list", "--count", "HEAD")
    return int(out) if out and out.isdigit() else None


# El nombre oficial es .yaml; .yml se tolera porque alguna página del wiki lo menciona así.
_MARKER_FILES = (".classroom50.yaml", ".classroom50.yml")


def read_marker_prefix(path: Path) -> str | None:
    """`<classroom>-<tarea>` según el marcador `.classroom50.yaml` (o `.yml`) del repo.

    El esquema oficial (repo-config-v1) exige `classroom` y `assignment` en la raíz y permite
    claves extra (`schema`, `secret`, `owner`, `source`...), así que solo se leen los escalares
    de la raíz, sin dependencias de YAML y sin fallar con un archivo raro: cualquier problema
    equivale a "no hay marcador"."""
    for name in _MARKER_FILES:
        try:
            text = (path / name).read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            continue
        values: dict[str, str] = {}
        for line in text.splitlines():
            if not line or line[0] in " \t#-":  # anidado, comentario o lista: no es de la raíz
                continue
            key, sep, rest = line.partition(":")
            if not sep:
                continue
            value = rest.split(" #", 1)[0].strip().strip("'\"").strip()
            if value:
                values[key.strip().strip("'\"").lower()] = value
        if values.get("classroom") and values.get("assignment"):
            return f"{values['classroom']}-{values['assignment']}"
    return None


def list_repos(folder: str) -> list[ScannedRepo]:
    """Subcarpetas con .git, ordenadas por nombre. Los archivos (scores.csv) y las carpetas
    sin .git se ignoran."""
    root = Path(folder.strip().strip("'\"")).expanduser()
    if not root.is_dir():
        raise BatchError("La carpeta no existe. Revisa que la ruta esté completa.")
    repos = [
        ScannedRepo(
            folder=d.name,
            path=str(d.resolve()),
            origin_url=normalize_origin(_git(d, "config", "--get", "remote.origin.url")),
            commits=count_commits(d),
            marker_prefix=read_marker_prefix(d),
        )
        for d in sorted(root.iterdir())
        if d.is_dir() and not d.name.startswith(".") and (d / ".git").exists()
    ]
    if not repos:
        raise BatchError(
            "No hay repositorios en esa carpeta (no se encontró ninguna subcarpeta con .git)."
        )
    return repos


def resolve_prefix(repos: list[ScannedRepo]) -> tuple[str, list[str]]:
    """Prefijo `<classroom>-<tarea>` y avisos. El repo se llama en minúsculas
    (lower(classroom)-lower(tarea)-lower(usuario)) pero el marcador conserva las mayúsculas
    originales, así que la comparación las ignora y el prefijo sale como el nombre de la carpeta. Manda el marcador de Classroom 50 (separa bien
    los usuarios que comparten el primer segmento, como ana-x y ana-y); sin marcador, o si no
    calza con el nombre de la carpeta, se usa el prefijo común de los nombres."""
    votes: dict[str, int] = {}
    for r in repos:
        mark = r.marker_prefix
        if mark and r.folder.lower().startswith(mark.lower() + "-") and len(r.folder) > len(mark) + 1:
            votes[mark.lower()] = votes.get(mark.lower(), 0) + 1
    if not votes:
        return common_prefix([r.folder for r in repos]), []
    best = max(votes, key=lambda k: votes[k])
    warnings = []
    if len(votes) > 1:
        warnings.append(
            "Los repositorios declaran tareas distintas en .classroom50.yaml ("
            + ", ".join(sorted(votes))
            + f"); se usó {best}. Revisa que la carpeta sea de una sola tarea."
        )
    first = next(r.folder for r in repos if r.folder.lower().startswith(best + "-"))
    return first[: len(best)], warnings


def common_prefix(names: list[str]) -> str:
    """Prefijo común de los nombres, por segmentos separados con guion y sin el guion final.
    Siempre deja al menos un segmento para el grupo. Con un solo nombre se quita el último
    segmento; sin guiones, la tarea es el nombre completo."""
    split = [n.split("-") for n in names]
    if len(names) == 1:
        return "-".join(split[0][:-1]) or names[0]
    limit = min(len(parts) for parts in split) - 1
    shared = 0
    while shared < limit and all(parts[shared] == split[0][shared] for parts in split):
        shared += 1
    return "-".join(split[0][:shared])


def group_name(folder: str, prefix: str) -> str:
    """El grupo es el resto del nombre tras el prefijo (los usuarios pueden tener guiones)."""
    if prefix and folder.lower().startswith(prefix.lower() + "-"):
        return folder[len(prefix) + 1 :]
    return folder


def task_id_for(repos: list[ScannedRepo], prefix: str) -> tuple[str, list[str]]:
    """Id de la tarea y avisos. `owner/prefijo` con el owner del origin, igual que el flujo por
    URL; si algún repo no tiene origin o los owners difieren, `local/prefijo` con un aviso."""
    prefix = prefix or repos[0].folder
    owners = {r.origin_url.split("/")[3] for r in repos if r.origin_url}
    missing = [r.folder for r in repos if not r.origin_url]
    if missing:
        warning = (
            "Estos repositorios no tienen origin de GitHub, así que la tarea se llama "
            f"local/{prefix} y no se junta con los grupos abiertos por URL: " + ", ".join(missing)
        )
        return f"{LOCAL_OWNER}/{prefix}", [warning]
    if len(owners) > 1:
        warning = (
            "Los repositorios tienen organizaciones distintas ("
            + ", ".join(sorted(owners))
            + f"), así que la tarea se llama local/{prefix}."
        )
        return f"{LOCAL_OWNER}/{prefix}", [warning]
    return f"{owners.pop()}/{prefix}", []
