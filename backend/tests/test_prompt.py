import pytest

from app import llm
from app.git_analyzer import to_task_tz
from app.llm import LLMResponseFormatError, build_user_prompt, parse_findings_response
from app.main import _late_commits

import json
import logging
from datetime import datetime, timedelta, timezone


def _prompt(**over):
    args = dict(
        rubric=None, task_start=None, task_deadline=None, authors=["ana", "beto"],
        late_commits=None, work_commits=8, merge_commits=1, bitacora_commits=["0fc53ea", "c2713eb"],
        commit_summary="- abc | ana | 2026-05-27 10:00 -0400 | \"x\"",
        include_prompt_log=True, prompt_log="log", include_authorship=True, authorship="aut",
    )
    args.update(over)
    return build_user_prompt(**args)


def test_tag_order_and_defaults():
    p = _prompt()
    tags = ["<rubric>", "<task>", "<commits>", "<prompt_log>", "<authorship>"]
    assert [p.index(t) for t in tags] == sorted(p.index(t) for t in tags)
    assert llm.NO_RUBRIC_TEXT in p
    assert "Authors with commits in the repository (excluding bots and teaching staff): ana, beto" in p
    assert "Deadline: not provided." in p


def test_system_prompt_has_extra_alert_rule():
    line = 'If a case does not clearly fit "alert", classify it as "discrepancy".'
    extra = 'Any other striking pattern, such as a commit with many lines, is classified as "discrepancy" or "info", never as "alert".'
    lines = [l.strip(" -") for l in llm.SYSTEM_PROMPT.split("\n")]
    assert lines[lines.index(line) + 1] == extra


def test_not_included_vs_missing():
    p = _prompt(include_prompt_log=False, authorship=None)
    assert p.count(llm.NOT_INCLUDED_TEXT) == 1
    assert llm.MISSING_FILE_TEXT in p


def _finding(**over):
    f = {"type": "info", "criterion": None, "title": "t", "description": "d"}
    f.update(over)
    return f


def _resp(**over):
    d = {"findings": [_finding()], "not_assessable": [], "summary": "s"}
    d.update(over)
    return json.dumps(d)


def test_parse_ok():
    assert parse_findings_response(_resp())["not_assessable"] == []


@pytest.mark.parametrize(
    "bad",
    [
        _resp(findings=[{"type": "info", "title": "t", "description": "d"}]),  # sin criterion
        _resp(findings=[_finding(criterion=3)]),
        json.dumps({"findings": [], "summary": "s"}),  # sin not_assessable
        _resp(not_assessable="C5"),
    ],
)
def test_parse_rejects(bad):
    with pytest.raises(LLMResponseFormatError):
        parse_findings_response(bad)


def test_late_commit_uses_chile_time_not_utc():
    utc = timezone.utc
    # 2026-05-30 23:30 en Chile (UTC-4 en mayo) = 2026-05-31 03:30 UTC: NO es tardío.
    on_time = to_task_tz(datetime(2026, 5, 31, 3, 30, tzinfo=utc))
    late = to_task_tz(datetime(2026, 5, 31, 4, 30, tzinfo=utc))  # 00:30 del 31 en Chile
    commits = [{"hash": "a", "moment": on_time}, {"hash": "b", "moment": late}]
    assert _late_commits(commits, "2026-05-30") == ["b"]


def _alert(**over):
    f = _finding(type="alert", alert_case="commits_tardios")
    f.update(over)
    return f


def test_alert_with_valid_case_is_kept():
    parsed = parse_findings_response(_resp(findings=[_alert()]))
    assert parsed["findings"][0]["type"] == "alert"
    assert parsed["findings"][0]["alert_case"] == "commits_tardios"


@pytest.mark.parametrize("case", [None, "otro_caso", ""])
def test_alert_without_valid_case_becomes_discrepancy(case, caplog):
    with caplog.at_level(logging.WARNING, logger="app.llm"):
        parsed = parse_findings_response(_resp(findings=[_alert(alert_case=case, title="Algo llamativo")]))
    finding = parsed["findings"][0]
    assert finding["type"] == "discrepancy"
    assert finding["alert_case"] is None
    assert "convertido a 'discrepancy'" in caplog.text and "Algo llamativo" in caplog.text


def test_alert_missing_key_becomes_discrepancy():
    alert = _alert()
    del alert["alert_case"]
    assert parse_findings_response(_resp(findings=[alert]))["findings"][0]["type"] == "discrepancy"


def test_non_alert_has_null_alert_case():
    parsed = parse_findings_response(_resp(findings=[_finding(type="info", alert_case="commits_tardios"), _finding(type="discrepancy")]))
    assert [f["alert_case"] for f in parsed["findings"]] == [None, None]


def test_prompt_lists_alert_codes_and_precomputed_rule():
    for code in ("declarado_sin_commits", "commits_sin_declaracion", "commits_tardios", "bitacora_un_commit", "texto_dirigido"):
        assert f'- "{code}":' in llm.SYSTEM_PROMPT
    assert "Use the quantities already computed in <commits>; do not recompute them." in llm.SYSTEM_PROMPT
    assert "Every rubric criterion must appear in at least one finding" in llm.SYSTEM_PROMPT
    assert "Do not add conclusions after the fact" in llm.SYSTEM_PROMPT


@pytest.mark.parametrize("code,name", [(None, "Spanish"), ("es", "Spanish"), ("en", "English")])
def test_system_prompt_ends_with_the_reviewer_language(code, name):
    prompt = llm.system_prompt(code)
    assert prompt.startswith(llm.SYSTEM_PROMPT)
    assert prompt.endswith(f"\n\nProduce the answer in {name}.")


def test_analyze_request_only_accepts_known_languages():
    from pydantic import ValidationError

    from app.models import AnalyzeRequest

    assert AnalyzeRequest(repo_url="x").language == "es"
    assert AnalyzeRequest(repo_url="x", language="en").language == "en"
    with pytest.raises(ValidationError):
        AnalyzeRequest(repo_url="x", language="Klingon")


def test_commit_stats_and_format():
    from app.git_analyzer import compute_commit_stats, format_commits_for_prompt

    files = [
        {"filename": "a.py", "added": 10, "deleted": 0, "change": "added"},
        {"filename": "b.py", "added": 3, "deleted": 4, "change": "modified"},
        {"filename": "c.py", "added": 0, "deleted": 7, "change": "deleted"},
    ]
    stats = compute_commit_stats(files)
    assert stats == {"files": 3, "added_files": 1, "modified_files": 1, "deleted_files": 1,
                     "renamed_files": 0, "insertions": 13, "deletions": 11}
    text = format_commits_for_prompt([{"hash": "abc", "author": "x", "date": "d", "message": "m", "files": files, "stats": stats}])
    assert "Counts: 3 files (1 added, 1 modified, 1 deleted); lines: +13 -11" in text


def test_task_has_commit_counts_and_bitacora_commits():
    p = _prompt()
    assert "Commits: 8 work and 1 merge" in p
    assert "Commits that add or modify the prompt log: 2 (0fc53ea, c2713eb)" in p
    assert "prompt log: 0\n" in _prompt(bitacora_commits=[]) + "\n"


# --- verificación de alertas calculables ---
from app.alert_checks import bitacora_commits, verify_alerts


def _a(case, title="t"):
    return {"type": "alert", "alert_case": case, "criterion": None, "title": title, "description": "d"}


@pytest.mark.parametrize("hashes,kept", [(["a"], True), (["a", "b"], False), ([], False)])
def test_bitacora_alert_needs_exactly_one_commit(hashes, kept, caplog):
    with caplog.at_level(logging.WARNING, logger="app.alert_checks"):
        out = verify_alerts([_a("bitacora_un_commit")], bitacora_commit_hashes=hashes, late_commit_hashes=None)
    assert (len(out) == 1) is kept
    assert ("descartada" in caplog.text) is (not kept)


@pytest.mark.parametrize("late,kept", [(["x"], True), ([], False), (None, False)])
def test_late_alert_needs_late_commits(late, kept, caplog):
    with caplog.at_level(logging.WARNING, logger="app.alert_checks"):
        out = verify_alerts([_a("commits_tardios")], bitacora_commit_hashes=[], late_commit_hashes=late)
    assert (len(out) == 1) is kept
    assert ("descartada" in caplog.text) is (not kept)


def test_other_findings_and_alert_cases_are_not_verified():
    findings = [
        _a("texto_dirigido"),
        _a("declarado_sin_commits"),
        _a("commits_sin_declaracion"),
        {"type": "discrepancy", "alert_case": None, "criterion": None, "title": "t", "description": "d"},
    ]
    out = verify_alerts(findings, bitacora_commit_hashes=[], late_commit_hashes=None)
    assert out == findings


def test_bitacora_commits_matches_root_file_only():
    def c(h, path, change="modified"):
        return {"hash": h, "files": [{"path": path, "change": change}]}

    commits = [
        c("a", "bitacora_de_prompts.md", "added"),
        c("b", "bitacora_de_prompts.md"),
        c("c", "docs/bitacora_de_prompts.md"),
        c("d", "bitacora_de_prompts.md", "deleted"),
        c("e", "README.md"),
    ]
    assert bitacora_commits(commits) == ["a", "b"]
