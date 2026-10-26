from datetime import date
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


class LLMSettings(BaseModel):
    """Proveedor y modelo elegidos por el evaluador. La API key NO va aquí: viaja en el header
    X-LLM-Api-Key para que no quede en el body de ninguna petición registrada."""

    provider: str
    model: str | None = None  # sin modelo: Automático (solo OpenRouter)
    base_url: str | None = None  # opcional; obligatoria con provider "custom"


class AnalyzeRequest(BaseModel):
    repo_path: str | None = None
    repo_url: str | None = None
    include_prompt_log: bool = False
    include_authorship: bool = False
    rubric: str | None = None
    task_start: str | None = None  # "YYYY-MM-DD", 00:00 hora de Chile
    task_deadline: str | None = None  # "YYYY-MM-DD", 23:59 hora de Chile
    # Para guardar el resultado en la base: sin task_id el análisis no se guarda.
    task_id: str | None = None  # "owner/prefijo"
    rubric_version: int | None = None  # si no viene, se busca por el texto de la rúbrica
    llm: LLMSettings | None = None  # sin él se usa el respaldo del .env

    @field_validator("task_start", "task_deadline")
    @classmethod
    def _check_date(cls, value: str | None):
        if value:
            try:
                date.fromisoformat(value)
            except ValueError:
                raise ValueError("Las fechas deben tener formato YYYY-MM-DD.")
        return value or None

    @model_validator(mode="after")
    def _check_source(self):
        if not self.repo_path and not self.repo_url:
            raise ValueError("Hay que indicar repo_path o repo_url.")
        return self


class CommitEvidence(BaseModel):
    type: Literal["commit"]
    hash: str  # hash completo


class LinesEvidence(BaseModel):
    type: Literal["prompt_log", "authorship"]
    line_start: int  # base 1, inclusive
    line_end: int


Evidence = CommitEvidence | LinesEvidence


class Finding(BaseModel):
    type: Literal["info", "discrepancy", "alert"]
    criterion: str | None = None
    alert_case: (
        Literal[
            "declarado_sin_commits",
            "commits_sin_declaracion",
            "commits_tardios",
            "bitacora_un_commit",
            "texto_dirigido",
        ]
        | None
    ) = None
    title: str
    description: str
    # Referencias ya validadas contra el repo; vacía = "sin evidencia vinculada".
    evidence: list[Evidence] = []
    # El hallazgo informa que un artefacto falta o tiene otro nombre: no se espera evidencia.
    no_evidence_needed: bool = False


class AnalyzeResponse(BaseModel):
    findings: list[Finding]
    not_assessable: list[str] = []
    summary: str
    model_used: str
    tokens: dict
    sources_used: list[str]
    repo_analyzed: str
    timestamp: str
    rubric_version: int | None = None  # versión de la rúbrica usada; None = sin rúbrica o texto suelto


class DiffLine(BaseModel):
    type: Literal["added", "removed", "context"]
    content: str
    old_line_number: int | None = None
    new_line_number: int | None = None


class FileChange(BaseModel):
    filename: str
    change_type: Literal["added", "modified", "deleted", "renamed"]
    is_binary: bool = False
    lines: list[DiffLine] = []


class CommitDiffResponse(BaseModel):
    hash: str
    message_title: str
    author: str
    date: str
    files: list[FileChange]


class FileTypeContribution(BaseModel):
    insertions: int
    deletions: int


class CommitResult(BaseModel):
    hash: str
    isMergeCommit: bool
    # Fecha y hora del commit en hora de Chile (America/Santiago), ISO 8601 con offset.
    authoredAt: str
    messageTitle: str
    messageBody: str
    fileTypesAndContributionMap: dict[str, FileTypeContribution]


class DailyContribution(BaseModel):
    date: str
    commitResults: list[CommitResult]


class CommitsData(BaseModel):
    authorDailyContributionsMap: dict[str, list[DailyContribution]]
    authorFileTypeContributionMap: dict
    authorContributionVariance: dict
    authorDisplayNameMap: dict[str, str]


class CommitSummaryRequest(BaseModel):
    repo_url: str
    regenerate: bool = False  # True: vuelve a llamar al LLM y reemplaza el resumen guardado
    llm: LLMSettings | None = None  # sin él se usa el respaldo del .env


class SummaryFile(BaseModel):
    filename: str
    change: str


class MessageCheck(BaseModel):
    status: Literal[
        "coincide", "coincide_parcialmente", "no_coincide", "mensaje_generico", "no_evaluable"
    ]
    observation: str


class SummaryStats(BaseModel):
    files: int
    added_files: int
    modified_files: int
    deleted_files: int
    renamed_files: int
    insertions: int
    deletions: int


class SummaryCoverage(BaseModel):
    """Qué parte del diff vio el LLM. truncated=True: el resumen cubre solo una parte."""

    truncated: bool
    files_total: int
    files_complete: int
    files_partial: int
    files_omitted: int


class CommitSummaryResponse(BaseModel):
    commit_hash: str
    repo_url: str
    model: str
    created_at: str  # ISO 8601 UTC
    cached: bool  # True: venía de la base, sin llamar al LLM
    summary: str
    main_files: list[SummaryFile]
    message_check: MessageCheck
    stats: SummaryStats
    coverage: SummaryCoverage
