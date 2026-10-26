"""
Dos requests simultáneos a un repo nunca clonado (p. ej. /api/analyze y /api/commits a la vez)
no deben pisarse al clonar. No usa la red: el "origen" es un repo local (file://) y se agrega un
retraso artificial al clone para que las dos llamadas realmente coincidan.
"""

import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app import repo_cache

CLONE_DELAY_SECONDS = 1.0


def _git(*args):
    subprocess.run(["git", *args], check=True, capture_output=True)


def _origin(tmp_path: Path, owner: str, name: str) -> str:
    """Repo bare local con un commit, en una ruta con forma .../owner/name.git."""
    work = tmp_path / f"{name}_work"
    work.mkdir()
    _git("init", "-q", str(work))
    _git("-C", str(work), "config", "user.email", "test@example.com")
    _git("-C", str(work), "config", "user.name", "Test")
    (work / "README.md").write_text("hola\n")
    _git("-C", str(work), "add", "README.md")
    _git("-C", str(work), "commit", "-q", "-m", "init")
    parent = tmp_path / owner
    parent.mkdir(exist_ok=True)
    bare = parent / f"{name}.git"
    _git("clone", "-q", "--bare", str(work), str(bare))
    shutil.rmtree(work)
    return f"file://{bare}"


@pytest.fixture
def slow_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(repo_cache, "CACHE_ROOT", tmp_path / "cache")
    real_run = subprocess.run

    def slow_run(cmd, *args, **kwargs):
        if isinstance(cmd, list) and "clone" in cmd and any(str(a).startswith("file://") for a in cmd):
            time.sleep(CLONE_DELAY_SECONDS)
        return real_run(cmd, *args, **kwargs)

    monkeypatch.setattr(repo_cache.subprocess, "run", slow_run)
    return tmp_path


def test_concurrent_clone_of_a_new_repo(slow_cache):
    url = _origin(slow_cache, "owner", "reponuevo")
    results, errors = [], []

    def call():
        try:
            results.append(repo_cache.get_or_clone(url))
        except Exception as exc:  # noqa: BLE001 - la prueba solo mira si falló
            errors.append(exc)

    with ThreadPoolExecutor(max_workers=2) as pool:
        for future in [pool.submit(call) for _ in range(2)]:
            future.result()

    assert errors == [] and len(results) == 2 and results[0] == results[1]
    assert (results[0] / ".git").is_dir()


def test_sequential_calls_reuse_the_clone(slow_cache):
    url = _origin(slow_cache, "owner2", "reposecuencial")
    first = repo_cache.get_or_clone(url)
    assert repo_cache.get_or_clone(url) == first and (first / ".git").is_dir()


def test_cache_dir_is_configurable(tmp_path, monkeypatch):
    import importlib

    monkeypatch.setenv("TID_CACHE_DIR", str(tmp_path / "otra"))
    try:
        assert importlib.reload(repo_cache).CACHE_ROOT == tmp_path / "otra"
    finally:
        monkeypatch.undo()
        importlib.reload(repo_cache)
