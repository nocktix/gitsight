"""
Backend FastAPI del sistema de triangulación TID.

Endpoint único y flexible: el cliente elige qué fuentes sumar al análisis
(commits siempre, bitácora de prompts y/o autoría opcionales).
"""

import logging
import re
from datetime import date, datetime, time
from pathlib import Path
from time import monotonic

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import (
    commit_summary,
    model_catalog,
    db,
    alert_checks,
    artifacts,
    git_analyzer,
    llm,
    repo_cache,
    repository,
    rubric_extract,
)
from app.git_analyzer import CommitNotFoundError
from app import evidence, llm_providers
from app.llm_errors import LLMError, LLMResponseFormatError
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    CommitDiffResponse,
    CommitsData,
    CommitSummaryRequest,
    CommitSummaryResponse,
    LLMSettings,
)
from app.config import is_excluded_author
from app.repo_cache import CorruptedCacheError, RepoCloneError
from app.routes_db import router as db_router
from app.rubric_extract import MAX_RUBRIC_BYTES, RubricExtractionError

logger = logging.getLogger(__name__)

app = FastAPI(title="GitSight")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["Content-Type", "X-LLM-Api-Key"],
)
app.include_router(db_router)


class InvalidRepoPathError(Exception):
    def __init__(self, path: str):
        self.path = path


@app.exception_handler(InvalidRepoPathError)
def invalid_repo_path_handler(request: Request, exc: InvalidRepoPathError):
    return JSONResponse(
        status_code=400,
        content={
            "error": "invalid_repo_path",
            "message": "El path proporcionado no existe o no es un repositorio git válido.",
            "path_received": exc.path,
        },
    )


@app.exception_handler(RepoCloneError)
def repo_clone_error_handler(request: Request, exc: RepoCloneError):
    return JSONResponse(
        status_code=400,
        content={
            "error": "repo_clone_failed",
            "message": f"No se pudo clonar el repositorio: {exc.reason}",
            "repo_url": exc.repo_url,
        },
    )


@app.exception_handler(RubricExtractionError)
def rubric_extraction_error_handler(request: Request, exc: RubricExtractionError):
    return JSONResponse(
        status_code=400,
        content={"error": "rubric_extraction_failed", "message": exc.message},
    )


@app.exception_handler(CorruptedCacheError)
def corrupted_cache_error_handler(request: Request, exc: CorruptedCacheError):
    return JSONResponse(
        status_code=500,
        content={
            "error": "corrupted_cache",
            "message": (
                "La carpeta en caché existe pero no es un repositorio git "
                f"válido. Borrala manualmente y volvé a intentar: {exc.path}"
            ),
            "path": str(exc.path),
        },
    )


@app.exception_handler(CommitNotFoundError)
def commit_not_found_handler(request: Request, exc: CommitNotFoundError):
    return JSONResponse(
        status_code=404,
        content={
            "error": "commit_not_found",
            "message": f"El commit {exc.commit_hash} no existe en este repositorio.",
            "commit_hash": exc.commit_hash,
        },
    )


@app.exception_handler(LLMError)
def llm_error_handler(request: Request, exc: LLMError):
    return JSONResponse(
        status_code=exc.status,
        content={
            "error": exc.code,
            "message": exc.message,
            "detail": exc.detail,
            "model_attempted": exc.model_attempted,
        },
    )


@app.exception_handler(LLMResponseFormatError)
def llm_response_format_error_handler(request: Request, exc: LLMResponseFormatError):
    return JSONResponse(
        status_code=502,
        content={
            "error": "llm_invalid_response_format",
            "message": (
                f"El modelo {exc.model or 'del LLM'} no devolvió una respuesta en el "
                "formato JSON esperado, ni siquiera después de un reintento explícito "
                "pidiéndole JSON puro."
            ),
            "model_attempted": exc.model,
        },
    )


@app.get("/api/models")
def get_models():
    """Modelos que el evaluador puede elegir. No incluye nada de la configuración secreta."""
    return {"primary": model_catalog.primary_model(), "models": model_catalog.list_models()}


def _llm_config(settings: LLMSettings | None, api_key: str | None) -> llm_providers.LLMConfig:
    """Configuración del LLM de esta petición: lo que mandó el frontend (la key, en el header)
    o, sin eso, el respaldo del .env."""
    if settings is None:
        return llm_providers.resolve_config(None, None, None, None)
    return llm_providers.resolve_config(
        settings.provider, settings.model, settings.base_url, api_key
    )


def _resolve_repo(repo_path: str | None, repo_url: str | None) -> Path:
    """Prioriza repo_url (clonando/reusando en caché) sobre repo_path local."""
    if repo_url:
        resolved = repo_cache.get_or_clone(repo_url)
    else:
        resolved = Path(repo_path)

    if not resolved.is_dir() or not (resolved / ".git").is_dir():
        raise InvalidRepoPathError(str(resolved))

    return resolved


@app.get("/api/artifacts/{kind}")
def get_artifact(kind: str, repo_path: str | None = None, repo_url: str | None = None):
    """Contenido de un artefacto (bitácora de prompts o declaración de autoría) con el nombre
    real con que se encontró en el repo. `lines` usa la misma numeración (base 1) que la evidencia."""
    if kind not in artifacts.KINDS:
        raise HTTPException(
            status_code=404, detail=f"Artefacto desconocido: {kind!r} (usa {', '.join(artifacts.KINDS)})."
        )
    if not repo_path and not repo_url:
        raise HTTPException(status_code=400, detail="Hay que indicar repo_path o repo_url.")
    found = artifacts.find_artifact(str(_resolve_repo(repo_path, repo_url)), kind)
    return {
        "kind": kind,
        "exists": found is not None,
        "expected_filename": artifacts.EXPECTED[kind],
        "filename": found.filename if found else None,
        "renamed": found.renamed if found else False,
        "other_candidates": found.others if found else [],
        "lines": found.lines if found else [],
    }


@app.post("/api/llm/test")
def test_llm(settings: LLMSettings, x_llm_api_key: str | None = Header(default=None)):
    """Llamada mínima con la configuración recibida: sirve para validar proveedor, key y modelo."""
    config = _llm_config(settings, x_llm_api_key)
    started = monotonic()
    if config.model is None:
        config = config.with_model(model_catalog.primary_model())
    result = llm_providers.generate(
        [{"role": "user", "content": "Responde solo: ok"}],
        config,
        max_tokens=16,
        timeout=30.0,
    )
    return {
        "ok": True,
        "model": result.model,
        "latency_ms": round((monotonic() - started) * 1000),
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/commits", response_model=CommitsData)
def commits(repo_path: str | None = None, repo_url: str | None = None):
    if not repo_path and not repo_url:
        raise HTTPException(status_code=400, detail="Hay que indicar repo_path o repo_url.")

    repo_path_obj = _resolve_repo(repo_path, repo_url)

    data = git_analyzer.build_commits_data(str(repo_path_obj))
    return CommitsData(**data)


@app.get("/api/commits/{commit_hash}/diff", response_model=CommitDiffResponse)
def commit_diff(commit_hash: str, repo_path: str | None = None, repo_url: str | None = None):
    if not repo_path and not repo_url:
        raise HTTPException(status_code=400, detail="Hay que indicar repo_path o repo_url.")

    repo_path_obj = _resolve_repo(repo_path, repo_url)

    diff = git_analyzer.get_commit_diff(str(repo_path_obj), commit_hash)
    return CommitDiffResponse(**diff)


_HEX_HASH = re.compile(r"[0-9a-f]{7,40}")


def _check_hash(commit_hash: str) -> str:
    value = commit_hash.strip().lower()
    if not _HEX_HASH.fullmatch(value):
        raise HTTPException(status_code=400, detail="El hash del commit no es válido.")
    return value


@app.get("/api/commits/{commit_hash}/summary", response_model=CommitSummaryResponse)
def get_saved_commit_summary(commit_hash: str, repo_url: str):
    """Solo lee el resumen guardado: no clona el repo ni llama al LLM."""
    try:
        saved = repository.get_commit_summary(
            commit_summary.normalize_repo_url(repo_url), _check_hash(commit_hash)
        )
    except repository.AmbiguousCommitHashError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"El hash {exc.prefix} coincide con más de un commit guardado; usa más caracteres.",
        )
    if saved is None:
        raise HTTPException(status_code=404, detail="Este commit no tiene resumen guardado.")
    return CommitSummaryResponse(**saved, cached=True)


@app.post("/api/commits/{commit_hash}/summary", response_model=CommitSummaryResponse)
def summarize_commit(
    commit_hash: str,
    request: CommitSummaryRequest,
    x_llm_api_key: str | None = Header(default=None),
):
    """Resumen del commit con LLM. Si ya está guardado lo devuelve sin llamar al LLM, salvo
    que `regenerate` sea true: entonces genera uno nuevo y reemplaza el guardado."""
    commit_hash = _check_hash(commit_hash)
    requested_model = request.llm.model if request.llm else None
    repo_path = _resolve_repo(None, request.repo_url)
    commit = git_analyzer.get_commit_diff(str(repo_path), commit_hash)
    repo_key = commit_summary.normalize_repo_url(request.repo_url)

    if not request.regenerate:
        saved = repository.get_commit_summary(repo_key, commit["hash"])
        # Con un modelo explícito, el guardado solo sirve si lo generó ese mismo modelo.
        if saved is not None and (
            requested_model is None or model_catalog.matches_requested(saved, requested_model)
        ):
            return CommitSummaryResponse(**saved, cached=True)

    if not commit["files"]:
        raise HTTPException(status_code=400, detail="El commit no tiene cambios para resumir.")

    result, llm_result = commit_summary.summarize(
        commit, config=_llm_config(request.llm, x_llm_api_key)
    )
    try:
        created_at = repository.save_commit_summary(
            repo_url=repo_key, commit_hash=commit["hash"], model=llm_result.model_used,
            result=result, requested_model=requested_model,
        )
    except Exception:
        # Un fallo de la base no debe perder el resumen ya generado.
        logger.exception("No se pudo guardar el resumen del commit en la base de datos.")
        created_at = db.now_iso()
    return CommitSummaryResponse(
        **result,
        commit_hash=commit["hash"],
        repo_url=repo_key,
        model=llm_result.model_used,
        created_at=created_at,
        cached=False,
    )


@app.post("/api/rubric/extract")
async def extract_rubric(file: UploadFile = File(...)):
    """Extrae el texto de una rúbrica subida. No llama al LLM ni guarda nada."""
    # Se lee un byte de más para detectar el exceso sin cargar archivos enormes.
    data = await file.read(MAX_RUBRIC_BYTES + 1)
    text = rubric_extract.extract_rubric_text(file.filename or "", data)
    return {"text": text}


def _late_commits(commits: list[dict], deadline: str) -> list[str]:
    """Hashes de commits posteriores a las 23:59 (hora de Chile) del día de entrega."""
    limit = datetime.combine(
        date.fromisoformat(deadline), time(23, 59, 59), tzinfo=git_analyzer.TASK_TZ
    )
    return [c["hash"] for c in commits if c["moment"] > limit]


def _persist_analysis(
    request: AnalyzeRequest,
    commits: list[dict],
    response: AnalyzeResponse,
    rubric_version: int | None,
) -> None:
    """Guarda el análisis exitoso. Un fallo de la base no debe perder el resultado."""
    if not request.task_id:
        return
    try:
        # Con versión: 'version'. Sin versión: 'none' si no se usó rúbrica y 'unknown' si se usó
        # un texto que no corresponde a ninguna versión guardada.
        if rubric_version is not None:
            state = "version"
        else:
            state = "unknown" if "rubric" in response.sources_used else "none"
        head = max(commits, key=lambda c: c["moment"])["full_hash"] if commits else None
        repository.save_analysis(
            task_id=request.task_id,
            group_url=request.repo_url or request.repo_path,
            rubric_version=rubric_version,
            rubric_state=state,
            model=response.model_used,
            head_commit=head,
            created_at=response.timestamp,
            result=response.model_dump(),
        )
    except Exception:
        logger.exception("No se pudo guardar el análisis en la base de datos.")


def _resolve_rubric(request: AnalyzeRequest) -> tuple[str | None, int | None]:
    """Rúbrica de este análisis y su versión. Con `rubric_version` se usa el texto de esa versión
    guardada; sin versión ni texto, la versión activa de la tarea (así la elige el backend y no
    cada pantalla). Con solo `rubric` (texto suelto) se busca si coincide con alguna versión."""
    if request.task_id:
        if request.rubric_version is not None:
            row = repository.get_rubric_version(request.task_id, request.rubric_version)
            return row["content"], row["version"]
        if not (request.rubric and request.rubric.strip()):
            active = repository.get_current_rubric(request.task_id)
            if active:
                return active["content"], active["version"]
            return None, None
        return request.rubric, repository.find_rubric_version(request.task_id, request.rubric)
    return request.rubric, None


def _link_evidence(
    findings: list[dict],
    *,
    commits: list[dict],
    line_counts: dict[str, int],
    alert_commit_hashes: dict[str, list[str]],
) -> None:
    """Deja en cada hallazgo solo la evidencia que existe en el repo. Las alertas que se calculan
    con datos exactos (commits tardíos, bitácora en un commit) se enlazan a esos commits."""
    for finding in findings:
        refs = evidence.validate_evidence(
            finding.get("evidence"),
            commits=commits,
            line_counts=line_counts,
            finding_title=finding.get("title", ""),
        )
        computed = alert_commit_hashes.get(finding.get("alert_case") or "")
        if computed and not any(r["type"] == "commit" for r in refs):
            refs += evidence.validate_evidence(
                [{"type": "commit", "hash": h} for h in computed],
                commits=commits,
                line_counts=line_counts,
            )
        finding["evidence"] = refs


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest, x_llm_api_key: str | None = Header(default=None)):
    config = _llm_config(request.llm, x_llm_api_key)  # falla antes de clonar si no hay proveedor
    if (
        request.task_id
        and request.rubric_version is not None
        and not repository.rubric_version_exists(request.task_id, request.rubric_version)
    ):
        raise HTTPException(
            status_code=400,
            detail=f"La tarea {request.task_id} no tiene la versión {request.rubric_version} de rúbrica.",
        )

    rubric_text, rubric_version = _resolve_rubric(request)
    repo_path = _resolve_repo(request.repo_path, request.repo_url)

    # Mismo criterio que las rampas: sin bots ni staff del curso (por ejemplo, los commits
    # con el informe de evaluación no son trabajo del grupo y dispararían falsas alertas
    # de "commit posterior a la entrega").
    commits = [
        c
        for c in git_analyzer.extract_commits(str(repo_path))
        if not is_excluded_author(c["author"])
    ]
    commit_summary = git_analyzer.format_commits_for_prompt(commits)
    authors = sorted({c["author"] for c in commits})
    late_commits = (
        _late_commits(commits, request.task_deadline) if request.task_deadline else None
    )

    prompt_log = artifacts.find_artifact(str(repo_path), artifacts.PROMPT_LOG)
    authorship = artifacts.find_artifact(str(repo_path), artifacts.AUTHORSHIP)
    bitacora_commit_hashes = alert_checks.bitacora_commits(
        commits, prompt_log.filename if prompt_log else None
    )
    bitacora_content = prompt_log.text if prompt_log and request.include_prompt_log else None
    autoria_content = authorship.text if authorship and request.include_authorship else None

    user_prompt = llm.build_user_prompt(
        rubric=rubric_text,
        task_start=request.task_start,
        task_deadline=request.task_deadline,
        authors=authors,
        late_commits=late_commits,
        work_commits=sum(not c["merge"] for c in commits),
        merge_commits=sum(c["merge"] for c in commits),
        bitacora_commits=bitacora_commit_hashes,
        commit_summary=commit_summary,
        include_prompt_log=request.include_prompt_log,
        prompt_log=bitacora_content,
        include_authorship=request.include_authorship,
        authorship=autoria_content,
    )

    # Un artefacto solo cuenta como usado si se pidió y se encontró en el repo.
    sources_used = ["commits"]
    if bitacora_content is not None:
        sources_used.append("prompt_log")
    if autoria_content is not None:
        sources_used.append("authorship")
    if rubric_text and rubric_text.strip():
        sources_used.append("rubric")

    parsed, result = llm.analyze_structured(llm.SYSTEM_PROMPT, user_prompt, config=config)
    parsed["findings"] = alert_checks.verify_alerts(
        parsed["findings"],
        bitacora_commit_hashes=bitacora_commit_hashes,
        late_commit_hashes=late_commits,
    )

    line_counts = {
        kind: len(artifact.lines)
        for kind, artifact, used in (
            (artifacts.PROMPT_LOG, prompt_log, bitacora_content is not None),
            (artifacts.AUTHORSHIP, authorship, autoria_content is not None),
        )
        if used
    }
    _link_evidence(
        parsed["findings"],
        commits=commits,
        line_counts=line_counts,
        alert_commit_hashes={
            "commits_tardios": late_commits or [],
            "bitacora_un_commit": bitacora_commit_hashes,
        },
    )
    # El nombre distinto al esperado (o más de un candidato) es un hecho que el evaluador debe ver.
    for kind, artifact, used in (
        (artifacts.PROMPT_LOG, prompt_log, bitacora_content is not None),
        (artifacts.AUTHORSHIP, authorship, autoria_content is not None),
    ):
        note = artifacts.info_finding(artifact) if artifact and used else None
        if note:
            parsed["findings"].append(note)

    # Sin rúbrica no hay criterios a los que referirse: si el modelo inventó nombres de
    # criterio (o criterios "no evaluables"), se descartan para no mostrar criterios falsos.
    if not (rubric_text and rubric_text.strip()):
        for finding in parsed["findings"]:
            finding["criterion"] = None
        parsed["not_assessable"] = []

    response = AnalyzeResponse(
        findings=parsed["findings"],
        not_assessable=parsed["not_assessable"],
        summary=parsed["summary"],
        model_used=result.model_used,
        tokens={
            "prompt": result.tokens_prompt,
            "completion": result.tokens_completion,
            "total": result.tokens_total,
        },
        sources_used=sources_used,
        repo_analyzed=str(repo_path),
        timestamp=db.now_iso(),
        rubric_version=rubric_version,
    )
    _persist_analysis(request, commits, response, rubric_version)
    return response
