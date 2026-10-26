"""Endpoints de persistencia: tareas, rúbricas versionadas, análisis e importación."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, field_validator

from app import repository, rubrics

router = APIRouter(prefix="/api")

MAX_NOTE_CHARS = 500


class TaskIn(BaseModel):
    start_date: str | None = None  # "YYYY-MM-DD"
    end_date: str | None = None

    @field_validator("start_date", "end_date")
    @classmethod
    def _check_date(cls, value: str | None):
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                raise ValueError("Las fechas deben tener formato YYYY-MM-DD.")
        return value or None


class RubricVersionIn(BaseModel):
    content: str
    filename: str | None = None  # archivo original, si se subió uno
    note: str | None = None
    activate: bool = True  # la versión nueva pasa a ser la activa de la tarea

    @field_validator("content")
    @classmethod
    def _not_blank(cls, value: str):
        if not value.strip():
            raise ValueError("La rúbrica no puede estar vacía.")
        return value

    @field_validator("filename")
    @classmethod
    def _basename(cls, value: str | None):
        # Solo el nombre: sin carpetas, que no sirven y pueden revelar rutas del equipo.
        name = (value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        return name[:255] or None

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None):
        text = (value or "").strip()
        if len(text) > MAX_NOTE_CHARS:
            raise ValueError(f"La nota no puede pasar de {MAX_NOTE_CHARS} caracteres.")
        return text or None


class ImportGroup(BaseModel):
    url: str
    name: str


class GroupsIn(BaseModel):
    groups: list[ImportGroup]

    @field_validator("groups")
    @classmethod
    def _check_groups(cls, value: list[ImportGroup]):
        if any(not g.url.strip() or not g.name.strip() for g in value):
            raise ValueError("Cada grupo necesita url y nombre.")
        return value


class ImportTask(BaseModel):
    """Forma de `tid.task.<taskId>` en localStorage."""

    model_config = ConfigDict(extra="ignore")
    rubric: str | None = None
    startDate: str = ""
    endDate: str = ""
    groups: list[ImportGroup] = []


class ImportAnalysis(BaseModel):
    """Forma de `tid.analysis.<repoUrl>` en localStorage."""

    data: dict
    rubric: str | None = None


class ImportPayload(BaseModel):
    tasks: dict[str, ImportTask] = {}
    analyses: dict[str, ImportAnalysis] = {}


@router.get("/tasks")
def list_tasks():
    return repository.list_task_ids()


@router.get("/tasks/{owner}/{name}")
def get_task(owner: str, name: str):
    task = repository.get_task(f"{owner}/{name}")
    if task is None:
        raise HTTPException(status_code=404, detail="La tarea no existe.")
    return task


@router.put("/tasks/{owner}/{name}")
def put_task(owner: str, name: str, body: TaskIn):
    task_id = f"{owner}/{name}"
    repository.put_task(task_id, body.start_date, body.end_date)
    return repository.get_task(task_id)


@router.put("/tasks/{owner}/{name}/groups")
def put_groups(owner: str, name: str, body: GroupsIn):
    task_id = f"{owner}/{name}"
    conflicts = repository.add_groups(task_id, [g.model_dump() for g in body.groups])
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail="Estos grupos ya pertenecen a otra tarea: " + ", ".join(conflicts),
        )
    return repository.get_task(task_id)


def _version_out(row: dict, *, include_content: bool) -> dict:
    """Versión para la API; `criteria_count` es None si la rúbrica no tiene criterios reconocibles."""
    criteria = rubrics.parse_criteria(row["content"])
    out = {
        **row,
        "criteria_count": len(criteria) if rubrics.is_structured(criteria) else None,
    }
    if include_content:
        out["criteria"] = criteria if rubrics.is_structured(criteria) else None
    else:
        del out["content"]
    return out


def _require_version(task_id: str, version: int) -> dict:
    row = repository.get_rubric_version(task_id, version)
    if row is None:
        raise HTTPException(status_code=404, detail=f"La tarea no tiene la versión {version} de la rúbrica.")
    return row


@router.get("/tasks/{owner}/{name}/rubric")
def get_rubric(owner: str, name: str):
    """La versión activa: la que usan los análisis nuevos de todos los grupos de la tarea."""
    rubric = repository.get_current_rubric(f"{owner}/{name}")
    if rubric is None:
        raise HTTPException(status_code=404, detail="La tarea no tiene rúbrica.")
    return rubric


@router.get("/tasks/{owner}/{name}/rubric/versions")
def list_rubric_versions(owner: str, name: str, include_content: bool = False):
    """Versiones de la rúbrica de la tarea, la más reciente primero. Sin `include_content`
    se omite el texto (la lista es liviana)."""
    return [
        _version_out(r, include_content=include_content)
        for r in repository.list_rubric_versions(f"{owner}/{name}")
    ]


@router.post("/tasks/{owner}/{name}/rubric/versions")
def create_rubric_version(owner: str, name: str, body: RubricVersionIn):
    """Sube una rúbrica como versión nueva (nunca sobrescribe). Si el texto es idéntico al de
    cualquier versión existente no crea otra: devuelve esa y, con `activate`, la activa."""
    row, created = repository.create_rubric_version(
        f"{owner}/{name}",
        body.content,
        filename=body.filename,
        note=body.note,
        activate=body.activate,
    )
    return {**_version_out(row, include_content=True), "created": created}


@router.get("/tasks/{owner}/{name}/rubric/versions/{version}")
def get_rubric_version(owner: str, name: str, version: int):
    return _version_out(_require_version(f"{owner}/{name}", version), include_content=True)


@router.post("/tasks/{owner}/{name}/rubric/versions/{version}/activate")
def activate_rubric_version(owner: str, name: str, version: int):
    """Activa una versión anterior sin duplicarla: los próximos análisis de todos los grupos
    de la tarea la usarán. Los análisis ya hechos no cambian."""
    task_id = f"{owner}/{name}"
    row = repository.activate_rubric_version(task_id, version)
    if row is None:
        _require_version(task_id, version)  # lanza el 404
    return _version_out(row, include_content=True)


@router.get("/tasks/{owner}/{name}/rubric/compare")
def compare_rubric_versions(
    owner: str,
    name: str,
    from_version: int = Query(alias="from"),
    to_version: int = Query(alias="to"),
):
    """Criterios agregados, quitados y modificados al pasar de la versión `from` a la `to`.
    Con `structured: false` las rúbricas no tienen criterios reconocibles y solo se comparan
    como texto (la respuesta trae ambas versiones completas)."""
    task_id = f"{owner}/{name}"
    if from_version == to_version:
        raise HTTPException(status_code=400, detail="Elige dos versiones distintas para comparar.")
    old, new = _require_version(task_id, from_version), _require_version(task_id, to_version)
    return {
        "from": _version_out(old, include_content=True),
        "to": _version_out(new, include_content=True),
        **rubrics.compare(old["content"], new["content"]),
    }


@router.get("/analyses")
def get_analyses(group_url: str):
    return repository.list_analyses(group_url)


@router.post("/import")
def import_local_storage(payload: ImportPayload):
    return repository.import_data(
        {k: v.model_dump() for k, v in payload.tasks.items()},
        {k: v.model_dump() for k, v in payload.analyses.items()},
    )
