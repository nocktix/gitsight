"""Análisis por lote: escaneo de una carpeta con los repos de una tarea."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import batch, repository

router = APIRouter(prefix="/api/batch")


class ScanIn(BaseModel):
    folder: str


@router.post("/scan")
def scan(body: ScanIn):
    try:
        repos = batch.list_repos(body.folder)
    except batch.BatchError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    prefix, prefix_warnings = batch.resolve_prefix(repos)
    task_id, warnings = batch.task_id_for(repos, prefix)
    warnings = prefix_warnings + warnings
    groups = [
        {
            # Clave del grupo: la URL del origin (la del flujo por URL); sin origin, la ruta.
            "url": r.origin_url or r.path,
            "name": batch.group_name(r.folder, prefix),
            "local_path": r.path,
        }
        for r in repos
    ]
    # Re-escanear una descarga más nueva actualiza local_path de los grupos que ya existen.
    conflicts = repository.add_groups(task_id, groups)
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail="Estos grupos ya pertenecen a otra tarea: " + ", ".join(conflicts),
        )
    return {
        "task_id": task_id,
        "warnings": warnings,
        "groups": [
            {
                "name": g["name"],
                "url": g["url"],
                "path": g["local_path"],
                "has_origin": g["url"] != g["local_path"],
                "commits": r.commits,
            }
            for g, r in zip(groups, repos)
        ],
    }
