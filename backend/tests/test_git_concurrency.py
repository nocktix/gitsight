"""Abrir el mismo repo desde dos peticiones a la vez no debe chocar con el candado de git."""

import subprocess
import threading

from app import git_analyzer


def _repo(tmp_path):
    def git(*args):
        subprocess.run(["git", "-C", str(tmp_path), *args], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.email", "a@b.c")
    git("config", "user.name", "Ana")
    (tmp_path / "a.txt").write_text("hola\n")
    git("add", ".")
    git("commit", "-q", "-m", "uno")
    return tmp_path


def test_parallel_openings_of_the_same_repo_do_not_fail(tmp_path):
    repo = _repo(tmp_path)
    full = git_analyzer.extract_commits(str(repo))[0]["full_hash"]
    errors, results = [], []

    def work():
        try:
            results.append(git_analyzer.get_commit_diff(str(repo), full)["hash"])
        except Exception as exc:  # noqa: BLE001 - la prueba solo mira si falló
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == [] and results == [full] * 12


def test_empty_repo_and_missing_commit_still_behave(tmp_path):
    repo = _repo(tmp_path)
    try:
        git_analyzer.get_commit_diff(str(repo), "f" * 40)
    except git_analyzer.CommitNotFoundError:
        pass
    else:
        raise AssertionError("debía lanzar CommitNotFoundError")
