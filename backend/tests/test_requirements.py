"""requirements.txt debe cubrir todo lo que el backend importa (y nada que ya no se use)."""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# nombre con que se importa -> nombre del paquete en PyPI
PACKAGE_OF = {
    "dotenv": "python-dotenv",
    "docx": "python-docx",
    "multipart": "python-multipart",
    "pydriller": "pydriller",
    "pypdf": "pypdf",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "httpx": "httpx",
    "pydantic": "fastapi",  # viene con FastAPI
    "starlette": "fastapi",  # viene con FastAPI
}


def _requirements(name: str) -> set[str]:
    out = set()
    for line in (ROOT / name).read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-"):
            out.add(re.split(r"[\[<>=~! ]", line)[0].lower())
    return out


def _imports() -> set[str]:
    names: set[str] = set()
    for path in (ROOT / "app").glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return {n for n in names if n not in sys.stdlib_module_names and n != "app"}


def test_every_third_party_import_is_in_requirements():
    declared = _requirements("requirements.txt")
    missing = [n for n in sorted(_imports()) if PACKAGE_OF.get(n, n).lower() not in declared]
    assert missing == [], f"faltan en requirements.txt: {missing}"


def test_unused_packages_are_not_declared():
    assert "openai" not in _requirements("requirements.txt")


def test_windows_has_timezone_data():
    # zoneinfo("America/Santiago") falla en Windows sin el paquete tzdata
    assert "tzdata" in _requirements("requirements.txt")
