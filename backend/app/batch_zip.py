"""Descompresión segura de los .zip del análisis por lote.

Un .zip se descomprime en `<caché>/zips/<nombre>-<hash>`, donde el hash depende de la ruta, el
tamaño y la fecha del archivo: si el zip cambia se vuelve a descomprimir, y si no, se reutiliza la
carpeta. El zip original nunca se modifica."""

import hashlib
import os
import shutil
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from app import repo_cache

MAX_UNZIPPED_BYTES = 2 * 1024**3  # tope de tamaño descomprimido (2 GiB)
_CHUNK = 1024 * 1024
_IGNORED = {"__MACOSX", ".DS_Store"}


class ZipProblem(Exception):
    """El zip no se pudo descomprimir; el mensaje (sin el nombre del archivo) explica por qué."""


def zips_root() -> Path:
    """Carpeta de los zips descomprimidos, al lado de la caché de repos (respeta TID_CACHE_DIR)."""
    return repo_cache.CACHE_ROOT.parent / "zips"


def _dest_for(zip_path: Path) -> Path:
    stat = zip_path.stat()
    key = f"{zip_path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in zip_path.stem) or "zip"
    return zips_root() / f"{safe}-{digest}"


def _safe_parts(name: str) -> list[str] | None:
    """Partes de la ruta de un miembro, o None si hay que ignorarlo (basura de macOS) o si
    intenta salir de la carpeta destino (absoluta, con `..` o con letra de unidad)."""
    parts = [p for p in PurePosixPath(name.replace("\\", "/")).parts if p not in ("", ".")]
    if not parts or parts[0] == "/" or any(p == ".." or ":" in p for p in parts):
        return None
    if any(p in _IGNORED for p in parts):
        return None
    return parts


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return (info.external_attr >> 16) & 0o170000 == 0o120000


def _extract_into(zf: zipfile.ZipFile, target: Path) -> None:
    infos = zf.infolist()
    if sum(i.file_size for i in infos) > MAX_UNZIPPED_BYTES:
        raise ZipProblem("es demasiado grande al descomprimirlo.")
    base = target.resolve()
    written = 0
    for info in infos:
        parts = _safe_parts(info.filename)
        if parts is None or _is_symlink(info):
            continue
        out = base.joinpath(*parts)
        if base not in out.resolve().parents and out.resolve() != base:
            continue  # defensa extra: nunca se escribe fuera del destino
        if info.is_dir():
            out.mkdir(parents=True, exist_ok=True)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(out, "wb") as dst:
            while chunk := src.read(_CHUNK):
                written += len(chunk)
                if written > MAX_UNZIPPED_BYTES:  # el tamaño declarado puede mentir
                    raise ZipProblem("es demasiado grande al descomprimirlo.")
                dst.write(chunk)


def extract(zip_path: Path) -> Path:
    """Carpeta con el contenido del zip (reutiliza la caché si el zip no cambió). Lanza
    ZipProblem si está dañado o es demasiado grande."""
    dest = _dest_for(zip_path)
    if dest.is_dir():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.parent / f".tmp-{uuid.uuid4().hex}"
    try:
        tmp.mkdir()
        with zipfile.ZipFile(zip_path) as zf:
            _extract_into(zf, tmp)
        try:
            os.rename(tmp, dest)  # una extracción cortada nunca queda como válida
        except OSError:
            if not dest.is_dir():  # si otro proceso ya la dejó lista, se usa esa
                raise
    except (zipfile.BadZipFile, EOFError, OSError, RuntimeError, NotImplementedError) as exc:
        raise ZipProblem("está dañado o no se pudo leer.") from exc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return dest
