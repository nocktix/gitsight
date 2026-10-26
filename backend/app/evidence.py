"""
Evidencia de los hallazgos: referencias a commits y a líneas de los artefactos.

El LLM cita lo que ve en el prompt (hash de <commits>, números de línea de las otras etiquetas);
aquí se comprueba cada referencia contra el repo real y se descarta la que no exista: al frontend
nunca llega una referencia inválida. Los hashes se normalizan al hash completo, que es el que
usa el calendario.
"""

import logging
import re

logger = logging.getLogger(__name__)

MAX_EVIDENCE_PER_FINDING = 8
_HEX = re.compile(r"[0-9a-f]{4,40}")


def number_lines(text: str) -> str:
    """Texto con `L<n>: ` al comienzo de cada línea (base 1), para que el LLM pueda citarlas."""
    return "\n".join(f"L{i}: {line}" for i, line in enumerate(text.splitlines(), start=1))


def _as_line(value) -> int | None:
    # bool es subclase de int: True no es un número de línea
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def resolve_commit(prefix: str, commits: list[dict]) -> str | None:
    """Hash completo del commit analizado que empieza con `prefix`; None si no existe o el
    prefijo es ambiguo."""
    prefix = prefix.strip().lower()
    if not _HEX.fullmatch(prefix):
        return None
    matches = {c["full_hash"] for c in commits if c["full_hash"].lower().startswith(prefix)}
    return matches.pop() if len(matches) == 1 else None


def validate_evidence(
    raw, *, commits: list[dict], line_counts: dict[str, int], finding_title: str = ""
) -> list[dict]:
    """Referencias válidas de un hallazgo, sin duplicados y con el hash completo.

    `line_counts` tiene el número de líneas de cada artefacto presente ("prompt_log",
    "authorship"); una referencia a un artefacto ausente se descarta."""
    if not isinstance(raw, list):
        return []
    valid: list[dict] = []
    for item in raw:
        ref = _validate_one(item, commits, line_counts)
        if ref is None:
            logger.warning("Referencia de evidencia descartada (%r) en: %s", item, finding_title)
        elif ref not in valid:
            valid.append(ref)
    return valid[:MAX_EVIDENCE_PER_FINDING]


def _validate_one(item, commits: list[dict], line_counts: dict[str, int]) -> dict | None:
    if not isinstance(item, dict):
        return None
    kind = item.get("type")
    if kind == "commit":
        hash_ = item.get("hash")
        full = resolve_commit(hash_, commits) if isinstance(hash_, str) else None
        return {"type": "commit", "hash": full} if full else None
    if kind in line_counts:
        start = _as_line(item.get("line_start"))
        end = _as_line(item.get("line_end", start))
        total = line_counts[kind]
        if start is None or end is None or not (1 <= start <= end <= total):
            return None
        return {"type": kind, "line_start": start, "line_end": end}
    return None
