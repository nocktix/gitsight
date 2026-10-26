"""Detección tolerante de artefactos, validación de evidencia y /api/artifacts."""

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import artifacts, evidence, llm, main
from app.llm_errors import LLMResponseFormatError

H1 = "a3f9c1d" + "0" * 33
H2 = "a3f9c1e" + "0" * 33  # comparte prefijo "a3f9c1" con H1
H3 = "b7e2d40" + "0" * 33
STATS = {"files": 0, "added_files": 0, "modified_files": 0, "deleted_files": 0,
         "renamed_files": 0, "insertions": 0, "deletions": 0}
COMMITS = [
    {"hash": h[:7], "full_hash": h, "author": "ana", "moment": None, "merge": False, "files": []}
    for h in (H1, H2, H3)
]


def _repo(tmp_path, *names, text="uno\ndos\ntres\n"):
    (tmp_path / ".git").mkdir(exist_ok=True)
    for name in names:
        (tmp_path / name).write_text(text, encoding="utf-8")
    return tmp_path


# --- detección tolerante --------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "bitacora_de_prompts.md",
        "Bitacora_de_Prompts.MD",
        "bitácora_de_prompts.md",
        "bitacora_de_propts.md",
        "bitacora_de_promps.md",
        "bitacora.md",
    ],
)
def test_prompt_log_is_found_under_similar_names(tmp_path, name):
    found = artifacts.find_artifact(_repo(tmp_path, name, "README.md", "Autoria.md"), "prompt_log")
    assert found and found.filename == name and found.others == []


def test_authorship_is_found_case_insensitively_with_accent(tmp_path):
    found = artifacts.find_artifact(_repo(tmp_path, "AUTORÍA.md", "README.md"), "authorship")
    assert found and found.filename == "AUTORÍA.md"


def test_unrelated_files_are_not_candidates(tmp_path):
    repo = _repo(tmp_path, "README.md", "notas.md", "bitacora.png", "Main.java")
    assert artifacts.find_artifact(repo, "prompt_log") is None
    assert artifacts.find_artifact(repo, "authorship") is None


def test_exact_name_wins_and_others_are_listed(tmp_path):
    repo = _repo(tmp_path, "bitacora_de_prompts.md", "bitacora_de_propts.md", "bitacora_vieja.md")
    found = artifacts.find_artifact(repo, "prompt_log")
    assert found.filename == "bitacora_de_prompts.md"
    assert sorted(found.others) == ["bitacora_de_propts.md", "bitacora_vieja.md"]
    assert found.renamed is False
    assert "Otros archivos con nombre parecido" in artifacts.info_finding(found)["description"]


def test_renamed_artifact_reports_an_info_finding(tmp_path):
    found = artifacts.find_artifact(_repo(tmp_path, "bitacora_de_propts.md"), "prompt_log")
    assert found.renamed
    finding = artifacts.info_finding(found)
    assert finding["type"] == "info" and finding["no_evidence_needed"] is True
    assert finding["description"] == (
        "Se encontró como bitacora_de_propts.md (nombre distinto al esperado)."
    )


def test_expected_name_with_only_case_difference_is_not_reported(tmp_path):
    found = artifacts.find_artifact(_repo(tmp_path, "autoria.md"), "authorship")
    assert not found.renamed and artifacts.info_finding(found) is None


# --- numeración de líneas -----------------------------------------------------------------------


def test_number_lines_is_one_based_and_keeps_blank_lines():
    assert evidence.number_lines("a\n\nc\n") == "L1: a\nL2: \nL3: c"


def test_prompt_numbers_artifact_lines():
    p = llm.build_user_prompt(
        rubric=None, task_start=None, task_deadline=None, authors=[], late_commits=None,
        work_commits=0, merge_commits=0, bitacora_commits=[], commit_summary="x",
        include_prompt_log=True, prompt_log="uno\ndos", include_authorship=True, authorship="tres",
    )
    assert "L1: uno\nL2: dos" in p and "L1: tres" in p


def test_system_prompt_explains_evidence():
    assert "[EVIDENCIA]" in llm.SYSTEM_PROMPT
    for t in ('"type": "commit"', '"type": "prompt_log"', '"type": "authorship"', "no_evidence_needed"):
        assert t in llm.SYSTEM_PROMPT


# --- validación de referencias --------------------------------------------------------------------

COUNTS = {"prompt_log": 10, "authorship": 5}


def _validate(*refs, counts=COUNTS):
    return evidence.validate_evidence(list(refs), commits=COMMITS, line_counts=counts)


def test_full_and_short_unique_hash_resolve_to_the_full_hash():
    assert _validate({"type": "commit", "hash": H3}) == [{"type": "commit", "hash": H3}]
    assert _validate({"type": "commit", "hash": "b7e2d40"}) == [{"type": "commit", "hash": H3}]
    assert _validate({"type": "commit", "hash": "B7E2"}) == [{"type": "commit", "hash": H3}]


@pytest.mark.parametrize("bad", ["ffffff0", "a3f9c1", "zzzz", "", "a3f", 7, None])
def test_missing_ambiguous_or_malformed_hash_is_dropped(bad):
    assert _validate({"type": "commit", "hash": bad}) == []


@pytest.mark.parametrize(
    "ref",
    [
        {"type": "prompt_log", "line_start": 0, "line_end": 3},
        {"type": "prompt_log", "line_start": 3, "line_end": 11},
        {"type": "prompt_log", "line_start": 11, "line_end": 12},
        {"type": "prompt_log", "line_start": 5, "line_end": 4},
        {"type": "authorship", "line_start": 6, "line_end": 6},
        {"type": "prompt_log", "line_start": "3", "line_end": 4},
        {"type": "prompt_log", "line_start": True, "line_end": 2},
        {"type": "prompt_log", "line_start": 1.5, "line_end": 2},
        {"type": "prompt_log"},
        {"type": "otro", "line_start": 1, "line_end": 1},
        "commit a3f9c1d",
        None,
    ],
)
def test_invalid_line_references_are_dropped(ref):
    assert _validate(ref) == []


def test_valid_lines_and_single_line_default():
    assert _validate({"type": "prompt_log", "line_start": 1, "line_end": 10}) == [
        {"type": "prompt_log", "line_start": 1, "line_end": 10}
    ]
    assert _validate({"type": "authorship", "line_start": 4}) == [
        {"type": "authorship", "line_start": 4, "line_end": 4}
    ]


def test_reference_to_an_artifact_that_is_absent_is_dropped():
    assert _validate({"type": "authorship", "line_start": 1, "line_end": 1}, counts={}) == []


def test_duplicates_removed_and_valid_kept_next_to_invalid():
    got = _validate(
        {"type": "commit", "hash": "b7e2d40"},
        {"type": "commit", "hash": H3},
        {"type": "commit", "hash": "ffffff0"},
        {"type": "authorship", "line_start": 2, "line_end": 3},
    )
    assert got == [{"type": "commit", "hash": H3}, {"type": "authorship", "line_start": 2, "line_end": 3}]


def test_non_list_evidence_is_empty():
    assert evidence.validate_evidence("x", commits=COMMITS, line_counts=COUNTS) == []
    assert evidence.validate_evidence(None, commits=COMMITS, line_counts=COUNTS) == []


# --- parser y reintento con el esquema nuevo ----------------------------------------------------------


def _finding(**over):
    f = {"type": "info", "criterion": None, "title": "t", "description": "d"}
    f.update(over)
    return f


def _resp(*findings):
    return json.dumps({"findings": list(findings), "not_assessable": [], "summary": "s"})


def test_parser_accepts_missing_or_malformed_evidence_without_failing():
    parsed = llm.parse_findings_response(
        _resp(_finding(), _finding(evidence="mal"), _finding(evidence=[{"type": "commit", "hash": "x"}],
                                                          no_evidence_needed="sí"))
    )
    assert [f["evidence"] for f in parsed["findings"]][:2] == [[], []]
    assert parsed["findings"][2]["evidence"] == [{"type": "commit", "hash": "x"}]  # se valida después
    assert [f["no_evidence_needed"] for f in parsed["findings"]] == [False, False, False]


def test_invalid_json_is_retried_and_evidence_survives(monkeypatch):
    good = _resp(_finding(evidence=[{"type": "commit", "hash": "b7e2d40"}], no_evidence_needed=True))
    answers = iter(["no es json", good])
    prompts = []

    def fake(config, system, user):
        prompts.append(user)
        return llm.AnalysisResult(next(answers), "m", 1, 1, 2)

    monkeypatch.setattr(llm, "_call_model", fake)
    cfg = llm.LLMConfig("openai", "m", "https://x/v1", "k")
    parsed, _ = llm.analyze_structured(llm.SYSTEM_PROMPT, "u", config=cfg)
    assert len(prompts) == 2 and "evidence" in prompts[1]
    assert parsed["findings"][0]["evidence"] == [{"type": "commit", "hash": "b7e2d40"}]
    assert parsed["findings"][0]["no_evidence_needed"] is True


def test_retry_gives_up_with_format_error(monkeypatch):
    monkeypatch.setattr(llm, "_call_model", lambda c, s, u: llm.AnalysisResult("basura", "m", 1, 1, 2))
    with pytest.raises(LLMResponseFormatError):
        llm.analyze_structured(llm.SYSTEM_PROMPT, "u", config=llm.LLMConfig("openai", "m", "https://x/v1", "k"))


# --- /api/analyze y /api/artifacts ----------------------------------------------------------------------


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("TID_DB_PATH", str(tmp_path / "t.db"))
    (tmp_path / "r").mkdir()
    repo = _repo(tmp_path / "r", "bitacora_de_propts.md", "Autoria.md", text="l1\nl2\nl3\nl4\n")
    monkeypatch.setattr(main, "_resolve_repo", lambda *_: repo)
    log_file = {"path": "bitacora_de_propts.md", "filename": "bitacora_de_propts.md",
                "change": "added", "added": 4, "deleted": 0}
    commits = [
        dict(c, files=[log_file] if c["full_hash"] == H3 else [], moment=datetime(2026, 5, 1, tzinfo=timezone.utc),
             date="d", message="m", stats=STATS)
        for c in COMMITS
    ]
    monkeypatch.setattr(main.git_analyzer, "extract_commits", lambda _p: commits)
    return TestClient(main.app), monkeypatch


def _analyze(api, findings, **body):
    client, mp = api
    mp.setattr(llm, "_call_model", lambda c, s, u: llm.AnalysisResult(_resp(*findings), "m", 1, 1, 2))
    r = client.post(
        "/api/analyze",
        json={"repo_url": "https://github.com/o/r", "include_prompt_log": True, "include_authorship": True,
              "llm": {"provider": "openai", "model": "m"}, **body},
        headers={"X-LLM-Api-Key": "k"},
    )
    assert r.status_code == 200, r.text
    return r.json()["findings"]


def test_analyze_keeps_only_valid_evidence_and_full_hashes(api):
    findings = _analyze(api, [
        _finding(title="a", evidence=[
            {"type": "commit", "hash": "b7e2d40"}, {"type": "commit", "hash": "ffffff0"},
            {"type": "commit", "hash": "a3f9c1"},  # ambiguo
            {"type": "authorship", "line_start": 2, "line_end": 9},  # fuera de rango
            {"type": "prompt_log", "line_start": 1, "line_end": 3},
        ]),
        _finding(title="b"),
    ])
    assert findings[0]["evidence"] == [
        {"type": "commit", "hash": H3}, {"type": "prompt_log", "line_start": 1, "line_end": 3}
    ]
    assert findings[1]["evidence"] == [] and findings[1]["no_evidence_needed"] is False


def test_analyze_reports_the_renamed_log_as_info_finding(api):
    findings = _analyze(api, [_finding(title="x")])
    note = [f for f in findings if "otro nombre" in f["title"]]
    assert len(note) == 1 and note[0]["type"] == "info"
    assert note[0]["description"] == "Se encontró como bitacora_de_propts.md (nombre distinto al esperado)."
    assert note[0]["no_evidence_needed"] is True and note[0]["evidence"] == []
    assert not [f for f in findings if "Autoria" in f["description"]]  # nombre esperado: sin nota


def test_renamed_log_still_counts_for_the_one_commit_alert(api):
    f = _finding(type="alert", alert_case="bitacora_un_commit", title="una vez", evidence=[])
    out = _analyze(api, [f])
    alert = next(x for x in out if x["title"] == "una vez")
    assert alert["type"] == "alert"  # no se descarta: se buscó con el nombre real
    assert alert["evidence"] == [{"type": "commit", "hash": H3}]  # enlazada al commit calculado


def test_no_note_when_the_artifact_was_not_included(api):
    findings = _analyze(api, [_finding()], include_prompt_log=False)
    assert not [f for f in findings if "otro nombre" in f["title"]]


def test_artifacts_endpoint_returns_real_name_and_numbered_lines(api):
    client, _ = api
    r = client.get("/api/artifacts/prompt_log", params={"repo_url": "https://github.com/o/r"})
    assert r.status_code == 200
    assert r.json() == {
        "kind": "prompt_log", "exists": True, "expected_filename": "bitacora_de_prompts.md",
        "filename": "bitacora_de_propts.md", "renamed": True, "other_candidates": [],
        "lines": ["l1", "l2", "l3", "l4"],
    }
    a = client.get("/api/artifacts/authorship", params={"repo_url": "https://github.com/o/r"}).json()
    assert a["filename"] == "Autoria.md" and a["renamed"] is False


def test_artifacts_endpoint_missing_file_and_bad_kind(api, tmp_path, monkeypatch):
    client, mp = api
    (tmp_path / "vacio").mkdir()
    empty = _repo(tmp_path / "vacio", "README.md")
    mp.setattr(main, "_resolve_repo", lambda *_: empty)
    body = client.get("/api/artifacts/prompt_log", params={"repo_url": "u"}).json()
    assert body["exists"] is False and body["filename"] is None and body["lines"] == []
    assert body["expected_filename"] == "bitacora_de_prompts.md"
    assert client.get("/api/artifacts/otro", params={"repo_url": "u"}).status_code == 404
    assert client.get("/api/artifacts/prompt_log").status_code == 400
