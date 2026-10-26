"""
Criterios de una rúbrica y comparación entre dos versiones.

El texto de la rúbrica es lo único que se guarda; los criterios se reconocen al vuelo. Un criterio
es una línea (o fila de tabla) que empieza con un identificador y un título: "C1 - Uso de control
de versiones | descripción", "2. Plazos: descripción", "R3) Calidad". Las líneas siguientes que
no empiezan otro criterio se suman a la descripción. Con menos de dos criterios reconocidos, la
rúbrica se considera no estructurada y no se compara criterio por criterio.
"""

import re

MIN_CRITERIA = 2

_ID_TITLE = re.compile(r"^(?:criterio\s+)?([A-Za-z]{0,3}\d{1,3})\s*[-–—:.)]\s*(.+)$", re.IGNORECASE)
_SEPARATOR_ROW = re.compile(r"^[\s|:\-]+$")


def _squash(text: str) -> str:
    return " ".join(text.split())


def parse_criteria(text: str) -> list[dict]:
    """Criterios reconocidos, en orden: [{"id", "title", "description"}]. Vacía si no hay."""
    criteria: list[dict] = []
    seen: dict[str, int] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or _SEPARATOR_ROW.match(line):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        cells = [c for c in cells if c]
        match = _ID_TITLE.match(cells[0]) if cells else None
        if match:
            ident = match.group(1).upper()
            seen[ident] = seen.get(ident, 0) + 1
            if seen[ident] > 1:  # id repetido: se distingue para no pisar el anterior
                ident = f"{ident}#{seen[ident]}"
            criteria.append(
                {
                    "id": ident,
                    "title": _squash(match.group(2)),
                    "description": _squash(" ".join(cells[1:])),
                }
            )
        elif criteria:
            criteria[-1]["description"] = _squash(criteria[-1]["description"] + " " + line)
    return criteria


def is_structured(criteria: list[dict]) -> bool:
    return len(criteria) >= MIN_CRITERIA


def _norm_title(title: str) -> str:
    return re.sub(r"\W+", " ", title.lower()).strip()


def compare(old_text: str, new_text: str) -> dict:
    """Criterios agregados, quitados y modificados entre dos textos de rúbrica.

    Se emparejan por identificador; los que quedan sin pareja se intentan emparejar por título
    (el criterio cambió de número). Con alguna de las dos no estructurada devuelve
    {"structured": False} sin inventar diferencias."""
    old, new = parse_criteria(old_text), parse_criteria(new_text)
    if not (is_structured(old) and is_structured(new)):
        return {"structured": False, "added": [], "removed": [], "modified": [], "unchanged": 0}

    new_by_id = {c["id"]: c for c in new}
    pairs: list[tuple[dict, dict]] = []
    unmatched_old = []
    for c in old:
        match = new_by_id.pop(c["id"], None)
        if match is None:
            unmatched_old.append(c)
        else:
            pairs.append((c, match))
    unmatched_new = list(new_by_id.values())

    removed = []
    for c in unmatched_old:
        twin = next((n for n in unmatched_new if _norm_title(n["title"]) == _norm_title(c["title"])), None)
        if twin is not None:
            unmatched_new.remove(twin)
            pairs.append((c, twin))
        else:
            removed.append(c)

    modified, unchanged = [], 0
    for before, after in pairs:
        changed = [
            field
            for field, differs in (
                ("id", before["id"] != after["id"]),
                ("title", before["title"] != after["title"]),
                ("description", before["description"] != after["description"]),
            )
            if differs
        ]
        if changed:
            modified.append({"id": after["id"], "before": before, "after": after, "changed": changed})
        else:
            unchanged += 1
    return {
        "structured": True,
        "added": unmatched_new,
        "removed": removed,
        "modified": modified,
        "unchanged": unchanged,
    }
