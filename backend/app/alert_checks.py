"""
Verificación de alertas que se pueden comprobar con datos exactos.

El modelo a veces marca una alerta que los datos contradicen. Solo se verifican los casos
calculables desde git (bitacora_un_commit y commits_tardios); el resto pasa sin cambios.
"""

import logging

from app import artifacts

logger = logging.getLogger(__name__)


def bitacora_commits(commits: list[dict], filename: str | None = None) -> list[str]:
    """Hashes de los commits que agregan o modifican la bitácora de prompts (en la raíz del repo).
    `filename` es el nombre real encontrado (puede tener un typo); por defecto, el esperado."""
    filename = filename or artifacts.BITACORA_FILENAME
    return [
        c["hash"]
        for c in commits
        if any(
            f.get("path") == filename and f.get("change") != "deleted" for f in c["files"]
        )
    ]


def verify_alerts(
    findings: list[dict],
    *,
    bitacora_commit_hashes: list[str],
    late_commit_hashes: list[str] | None,
) -> list[dict]:
    """Descarta las alertas que los datos calculados contradicen; deja pasar todo lo demás."""
    kept = []
    for finding in findings:
        if finding.get("type") == "alert":
            case = finding.get("alert_case")
            reason = None
            if case == "bitacora_un_commit" and len(bitacora_commit_hashes) != 1:
                reason = (
                    f"la bitácora aparece en {len(bitacora_commit_hashes)} commits, no en exactamente 1"
                )
            elif case == "commits_tardios" and not late_commit_hashes:
                reason = (
                    "no hay fecha de entrega"
                    if late_commit_hashes is None
                    else "no hay commits posteriores a la entrega"
                )
            if reason:
                logger.warning(
                    "Alerta %r descartada (%s): %s", case, reason, finding.get("title")
                )
                continue
        kept.append(finding)
    return kept
