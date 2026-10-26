"""
Manejo de la caché local de repos clonados desde una URL de GitHub.

Cuando el request trae repo_url en vez de repo_path, clonamos (o reusamos,
sin actualizar) el repo en ~/.tid-cache/repos/<owner>_<repo>/ y devolvemos
esa ruta para que el resto del pipeline la trate como un repo_path más.
"""

import os
import shutil
import subprocess
import threading
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

# Carpeta de repos clonados; TID_CACHE_DIR la cambia (por defecto, ~/.tid-cache/repos).
CACHE_ROOT = Path(os.environ.get("TID_CACHE_DIR") or Path.home() / ".tid-cache" / "repos")

_CLONE_TIMEOUT_SECONDS = 60

# Lock por ruta de destino: serializa requests concurrentes para el mismo
# repo (evita el TOCTOU entre el check de existencia y el git clone) sin
# bloquear requests de repos distintos entre sí. _locks_guard protege el
# get-or-create del lock por ruta, que es en sí mismo un TOCTOU si dos
# threads piden el lock de una ruta nunca vista al mismo tiempo.
_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(dest: Path) -> threading.Lock:
    with _locks_guard:
        if dest not in _locks:
            _locks[dest] = threading.Lock()
        return _locks[dest]


class RepoCloneError(Exception):
    def __init__(self, repo_url: str, reason: str):
        self.repo_url = repo_url
        self.reason = reason


class CorruptedCacheError(Exception):
    def __init__(self, path: Path):
        self.path = path


def _folder_name_from_url(repo_url: str) -> str:
    """Deriva el nombre de carpeta 'owner_repo' a partir de la URL de GitHub."""
    parts = [p for p in urlparse(repo_url).path.split("/") if p]
    if len(parts) < 2:
        raise RepoCloneError(
            repo_url, "La URL no tiene el formato esperado (github.com/owner/repo)."
        )
    owner, repo = parts[-2], parts[-1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return f"{owner}_{repo}"


def get_or_clone(repo_url: str) -> Path:
    """Devuelve la ruta local del repo, clonándolo si todavía no está en caché."""
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    dest = CACHE_ROOT / _folder_name_from_url(repo_url)

    with _lock_for(dest):
        if dest.exists():
            if not (dest / ".git").is_dir():
                raise CorruptedCacheError(dest)
            return dest

        try:
            result = subprocess.run(
                ["git", "clone", repo_url, str(dest)],
                capture_output=True,
                text=True,
                timeout=_CLONE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            # dest no existía antes de este intento (recién lo chequeamos arriba),
            # así que si quedó algo a medio clonar es responsabilidad nuestra.
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            raise RepoCloneError(
                repo_url,
                f"git clone superó el timeout de {_CLONE_TIMEOUT_SECONDS}s "
                "(problema de red o repo muy grande).",
            )

        if result.returncode != 0:
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            raise RepoCloneError(repo_url, result.stderr.strip())

        return dest
