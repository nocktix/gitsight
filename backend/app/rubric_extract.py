"""
Extracción de texto de archivos de rúbrica (.pdf, .docx, .md, .txt).

Solo extrae texto: no llama al LLM ni guarda nada.
"""

import io
import zipfile
from pathlib import Path

MAX_RUBRIC_BYTES = 5 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".txt"}


class RubricExtractionError(Exception):
    """El archivo no se pudo convertir en texto; el mensaje va directo al usuario."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _from_pdf(data: bytes) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except (PyPdfError, ValueError, OSError) as exc:
        raise RubricExtractionError(f"No se pudo leer el PDF: {exc}") from exc
    text = "\n\n".join(p for p in pages if p)
    if not text.strip():
        raise RubricExtractionError(
            "El PDF no tiene texto extraíble (puede ser un escaneo). "
            "Pega el texto de la rúbrica manualmente."
        )
    return text


def _iter_docx_blocks(document):
    """Recorre párrafos y tablas en el orden en que aparecen en el documento."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    for child in document.element.body.iterchildren():
        if child.tag.endswith("}p"):
            yield Paragraph(child, document)
        elif child.tag.endswith("}tbl"):
            yield Table(child, document)


def _from_docx(data: bytes) -> str:
    from docx import Document
    from docx.opc.exceptions import PackageNotFoundError

    try:
        document = Document(io.BytesIO(data))
    except (PackageNotFoundError, zipfile.BadZipFile, ValueError, KeyError, OSError) as exc:
        raise RubricExtractionError(f"No se pudo leer el archivo .docx: {exc}") from exc

    lines: list[str] = []
    for block in _iter_docx_blocks(document):
        if hasattr(block, "rows"):  # tabla: una línea por fila, celdas separadas por " | "
            for row in block.rows:
                cells: list[str] = []
                for cell in row.cells:
                    text = " ".join(cell.text.split())
                    # las celdas combinadas se repiten en python-docx: se omiten duplicados contiguos
                    if not cells or cells[-1] != text:
                        cells.append(text)
                if any(cells):
                    lines.append(" | ".join(cells))
        elif block.text.strip():
            lines.append(block.text.strip())

    text = "\n".join(lines)
    if not text.strip():
        raise RubricExtractionError("El archivo .docx no tiene texto.")
    return text


def _from_text(data: bytes) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    if not text.strip():
        raise RubricExtractionError("El archivo está vacío.")
    return text


def extract_rubric_text(filename: str, data: bytes) -> str:
    """Devuelve el texto de la rúbrica o lanza RubricExtractionError."""
    ext = Path(filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise RubricExtractionError(
            "Formato no soportado. Usa un archivo .pdf, .docx, .md o .txt."
        )
    if not data:
        raise RubricExtractionError("El archivo está vacío.")
    if len(data) > MAX_RUBRIC_BYTES:
        raise RubricExtractionError("El archivo supera el límite de 5 MB.")

    if ext == ".pdf":
        return _from_pdf(data)
    if ext == ".docx":
        return _from_docx(data)
    return _from_text(data)
