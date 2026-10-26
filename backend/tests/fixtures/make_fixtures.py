"""Regenera rubrica_ficticia.pdf y rubrica_ficticia.docx desde los mismos datos que el .md.

Uso (desde triangulation-backend):  .venv/bin/python tests/fixtures/make_fixtures.py
Necesita reportlab (solo para generar el PDF; no es dependencia de la app).
"""

from pathlib import Path

from docx import Document
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

HERE = Path(__file__).parent

NOTE = "RÚBRICA FICTICIA: creada solo para pruebas. No corresponde a ningún curso real."
TITLE = "Rúbrica de la tarea (ficticia)"
HEADER = ["Criterio", "Descripción"]
ROWS = [
    ("C1 - Uso de control de versiones", "Historial de commits frecuente, con mensajes descriptivos y sin bloques de trabajo subidos de una sola vez."),
    ("C2 - Contribución individual", "Cada integrante aparece con commits propios y la distribución del trabajo coincide con lo declarado en Autoria.md."),
    ("C3 - Uso documentado de IA", "La bitácora de prompts registra el uso de IA generativa y se corresponde con los cambios del repositorio."),
    ("C4 - Cumplimiento de plazos", "El trabajo se entrega dentro de las fechas de inicio y entrega de la tarea."),
    ("C5 - Calidad del diseño orientado a objetos", "Abstracción, encapsulamiento, herencia y polimorfismo bien aplicados en las clases del sistema."),
]


def make_docx():
    doc = Document()
    doc.add_paragraph(NOTE)
    doc.add_heading(TITLE, level=1)
    table = doc.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    for cell, text in zip(table.rows[0].cells, HEADER):
        cell.text = text
    for name, desc in ROWS:
        cells = table.add_row().cells
        cells[0].text, cells[1].text = name, desc
    doc.save(HERE / "rubrica_ficticia.docx")


def make_pdf():
    styles = getSampleStyleSheet()
    cell = styles["BodyText"]
    data = [[Paragraph(f"<b>{h}</b>", cell) for h in HEADER]]
    data += [[Paragraph(n, cell), Paragraph(d, cell)] for n, d in ROWS]
    table = Table(data, colWidths=[170, 320])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    SimpleDocTemplate(str(HERE / "rubrica_ficticia.pdf"), pagesize=A4).build(
        [Paragraph(NOTE, styles["BodyText"]), Paragraph(TITLE, styles["Heading1"]), table]
    )


def make_md():
    lines = [f"<!-- {NOTE} -->", "", f"# {TITLE}", "", "| " + " | ".join(HEADER) + " |", "|---|---|"]
    lines += [f"| {n} | {d} |" for n, d in ROWS]
    (HERE / "rubrica_ficticia.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    make_md()
    make_docx()
    make_pdf()
