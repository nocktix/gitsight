"""
Lectura cruda de los artefactos de triangulación (bitácora de prompts y
declaración de autoría). Ninguno de los dos se parsea: se le pasan al LLM
como texto libre.

Los archivos se buscan en la raíz del repo sin distinguir mayúsculas ni tildes y aceptando
nombres parecidos (los estudiantes escriben `bitacora_de_propts.md`). Decir "falta la bitácora"
cuando existe con otro nombre sería un hecho falso.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

BITACORA_FILENAME = "bitacora_de_prompts.md"
AUTORIA_FILENAME = "Autoria.md"

PROMPT_LOG = "prompt_log"
AUTHORSHIP = "authorship"
KINDS = (PROMPT_LOG, AUTHORSHIP)

EXPECTED = {PROMPT_LOG: BITACORA_FILENAME, AUTHORSHIP: AUTORIA_FILENAME}
LABELS = {PROMPT_LOG: "bitácora de prompts", AUTHORSHIP: "declaración de autoría"}

_EXTENSIONS = {".md", ".markdown", ".txt"}
_MIN_SIMILARITY = 0.8
_PREFIX_SIMILARITY = 0.85  # "bitacora.md" o "autoria_grupo.md": empiezan con la palabra clave


@dataclass
class Artifact:
    kind: str
    filename: str  # nombre real encontrado en el repo
    text: str
    others: list[str] = field(default_factory=list)  # otros candidatos, del más al menos parecido

    @property
    def expected(self) -> str:
        return EXPECTED[self.kind]

    @property
    def renamed(self) -> bool:
        """Nombre distinto al esperado (una diferencia solo de mayúsculas no cuenta)."""
        return self.filename.lower() != self.expected.lower()

    @property
    def lines(self) -> list[str]:
        return self.text.splitlines()


def _normalize(name: str) -> str:
    stem = Path(name).stem
    stem = unicodedata.normalize("NFKD", stem)
    stem = "".join(c for c in stem if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "_", stem).strip("_")


def _similarity(filename: str, kind: str) -> float:
    if Path(filename).suffix.lower() not in _EXTENSIONS:
        return 0.0
    stem = _normalize(filename)
    target = _normalize(EXPECTED[kind])
    score = SequenceMatcher(None, stem, target).ratio()
    if stem.startswith(target.split("_")[0]):
        score = max(score, _PREFIX_SIMILARITY)
    return score


def find_artifact(repo_path: str, kind: str) -> Artifact | None:
    """Busca el artefacto en la raíz del repo; usa el candidato más parecido al nombre esperado
    (a igual parecido, el orden alfabético) y devuelve los demás en `others`. None si no hay."""
    root = Path(repo_path)
    scored = sorted(
        (
            (-score, path.name)
            for path in root.iterdir()
            if path.is_file() and (score := _similarity(path.name, kind)) >= _MIN_SIMILARITY
        ),
    )
    if not scored:
        return None
    names = [name for _, name in scored]
    text = (root / names[0]).read_text(encoding="utf-8", errors="replace")
    return Artifact(kind=kind, filename=names[0], text=text, others=names[1:])


def info_finding(artifact: Artifact) -> dict | None:
    """Hallazgo "info" cuando el artefacto se encontró con otro nombre o había más candidatos.
    None si el nombre es el esperado y no hay otros archivos parecidos."""
    if not artifact.renamed and not artifact.others:
        return None
    label = LABELS[artifact.kind]
    if artifact.renamed:
        title = f"{label.capitalize()} encontrada con otro nombre"
        text = f"Se encontró como {artifact.filename} (nombre distinto al esperado)."
    else:
        title = f"Hay más de un archivo parecido a la {label}"
        text = f"Se usó {artifact.filename}."
    if artifact.others:
        text += f" Otros archivos con nombre parecido: {', '.join(artifact.others)}."
    return {
        "type": "info",
        "criterion": None,
        "alert_case": None,
        "title": title,
        "description": text,
        "evidence": [],
        "no_evidence_needed": True,
    }
