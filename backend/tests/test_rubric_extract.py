import re
from pathlib import Path

import pytest

from app.rubric_extract import RubricExtractionError, extract_rubric_text

FIXTURES = Path(__file__).parent / "fixtures"
CRITERIA = [
    "C1 - Uso de control de versiones",
    "C2 - Contribución individual",
    "C3 - Uso documentado de IA",
    "C4 - Cumplimiento de plazos",
    "C5 - Calidad del diseño orientado a objetos",
]


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text)


@pytest.mark.parametrize("name", ["rubrica_ficticia.pdf", "rubrica_ficticia.docx", "rubrica_ficticia.md"])
def test_all_criteria_present_and_in_order(name):
    text = _flat(extract_rubric_text(name, (FIXTURES / name).read_bytes()))
    positions = [text.find(c) for c in CRITERIA]
    assert -1 not in positions, positions
    assert positions == sorted(positions)


def test_docx_table_is_row_by_row():
    text = extract_rubric_text("r.docx", (FIXTURES / "rubrica_ficticia.docx").read_bytes())
    assert "C2 - Contribución individual | Cada integrante aparece" in text


@pytest.mark.parametrize(
    "name,data",
    [("r.exe", b"x"), ("r.txt", b""), ("r.txt", b"   \n"), ("r.pdf", b"no es un pdf"), ("r.docx", b"no es docx")],
)
def test_errors(name, data):
    with pytest.raises(RubricExtractionError):
        extract_rubric_text(name, data)


def test_too_large():
    with pytest.raises(RubricExtractionError, match="5 MB"):
        extract_rubric_text("r.txt", b"a" * (5 * 1024 * 1024 + 1))


def test_pdf_without_text():
    from pypdf import PdfWriter
    import io

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    writer.write(buf)
    with pytest.raises(RubricExtractionError, match="texto extraíble"):
        extract_rubric_text("scan.pdf", buf.getvalue())
