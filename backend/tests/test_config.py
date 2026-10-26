from app.config import parse_excluded_authors


def test_the_classroom_bot_is_always_excluded():
    assert parse_excluded_authors(None) == ["github-classroom[bot]"]
    assert parse_excluded_authors("") == ["github-classroom[bot]"]
    assert parse_excluded_authors("   ,  ") == ["github-classroom[bot]"]


def test_listed_accounts_are_added_and_trimmed():
    assert parse_excluded_authors(" profe1 , Ayudante Uno ,,profe2") == [
        "github-classroom[bot]",
        "profe1",
        "Ayudante Uno",
        "profe2",
    ]


def test_duplicates_are_ignored_regardless_of_case():
    assert parse_excluded_authors("GitHub-Classroom[bot], Profe, profe") == [
        "github-classroom[bot]",
        "Profe",
    ]


def test_exclusion_ignores_case(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "_EXCLUDED_FOLDED", {n.casefold() for n in ["Profe Uno"]})
    assert config.is_excluded_author("profe uno") and not config.is_excluded_author("Estudiante A")
