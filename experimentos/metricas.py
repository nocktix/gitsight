#!/usr/bin/env python3
"""Métricas cuantitativas sobre análisis guardados de GitSight (solo lectura).

Uso: python3 metricas.py [--db ~/experimento-gitsight/tid-copia.db]
                         [--respuestas ~/Downloads/respuestas-correctas.json]
                         [--out ~/experimento-gitsight]
Trabaja sobre una COPIA de la base (se abre en modo solo lectura).
"""
import argparse, csv, json, re, sqlite3, statistics as st
from collections import defaultdict
from pathlib import Path

CRIT = ["C1", "C2", "C3", "C4", "C5"]
TIPOS = ["alert", "discrepancy", "info"]
FAKE = re.compile(r"fake|mock|dummy|stub|test-model", re.I)


def crit_code(s):
    m = re.match(r"\s*(C\d+)", s or "")
    return m.group(1) if m else None


def norm(s):
    s = re.sub(r"^\s*\d+\.\s*", "", s or "")
    s = re.sub(r"\([^)]*\)", " ", s).split(" - ")[0]
    s = re.sub(r"\\[a-zA-Z]+\{?", " ", s)
    return re.sub(r"[^a-z0-9áéíóúñ]+", " ", s.lower()).strip()


def criterios_rubrica(content):
    """Lista de criterios de una rúbrica de texto: «N. Título (X puntos)» o ítems LaTeX tras la sección Rúbrica."""
    num = {}
    for m in re.finditer(r"^\s*(\d+)\.\s+(.+?)\s*\(\d+\s*puntos?\)\s*$", content, re.M):
        num.setdefault(int(m.group(1)), m.group(2))
    if len(num) >= 2:
        return [num[k] for k in sorted(num)]
    if "\\section{Rúbrica}" in content:
        t = content.split("\\section{Rúbrica}", 1)[1]
        return [i.strip() for i in re.findall(r"\\item\s+(.+)", t)]
    return []


def match(crit, lista):
    n = norm(crit)
    for i, c in enumerate(lista):
        k = norm(c)
        if n and k and (n == k or n in k or k in n or k[:40] == n[:40]):
            return i
    return None


def cargar(db, where, params=()):
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    q = ("SELECT a.id, a.task_id, COALESCE(g.name, a.group_url), a.model, a.rubric_state, "
         "a.created_at, a.result_json FROM analyses a LEFT JOIN groups g ON g.url=a.group_url "
         f"WHERE {where} ORDER BY a.task_id, g.name, a.created_at")
    out = []
    for id_, task, grp, model, rstate, ts, rj in c.execute(q, params):
        out.append(dict(id=id_, task=task, grupo=grp, model=model, rstate=rstate, ts=ts,
                        d=json.loads(rj)))
    return out


def metricas(a, lista=None):
    d, F = a["d"], a["d"].get("findings", [])
    tipos = {t: sum(1 for f in F if f["type"] == t) for t in TIPOS}
    otros = len(F) - sum(tipos.values())
    en_hall = {crit_code(f.get("criterion")) for f in F} - {None}
    no_eval = {crit_code(x) for x in d.get("not_assessable", [])} - {None}
    cubiertos = [c for c in CRIT if c in en_hall or c in no_eval]
    sin_match = 0
    if lista:
        idx = set()
        for x in [f.get("criterion") for f in F if f.get("criterion")] + list(d.get("not_assessable", [])):
            i = match(x, lista)
            if i is None: sin_match += 1
            else: idx.add(i)
        cubiertos = [c for c in range(len(lista)) if c in idx]
        faltan = [f"#{c + 1}" for c in range(len(lista)) if c not in idx]
        ncrit = len(lista)
    else:
        faltan = [c for c in CRIT if c not in cubiertos]
        ncrit = len(CRIT)
    citas = [len(f.get("evidence") or []) for f in F]
    return dict(
        n=len(F), tipos=tipos, otros=otros,
        alertas=sorted({f["alert_case"] for f in F if f.get("alert_case")}),
        n_alertas_casos=[f["alert_case"] for f in F if f.get("alert_case")],
        cobertura=100 * len(cubiertos) / ncrit, faltan=faltan, sin_match=sin_match, ncrit=ncrit,
        no_eval=sorted(no_eval),
        con_cita=sum(1 for x in citas if x > 0), total_citas=sum(citas),
        sin_cita_nne=sum(1 for f, x in zip(F, citas) if x == 0 and f.get("no_evidence_needed")),
    )


def pct(a, b):
    return 100 * a / b if b else float("nan")


def f1(x):
    return "n/d" if x != x else f"{x:.1f}"


def tabla(h, filas):
    s = "| " + " | ".join(h) + " |\n|" + "|".join("---" for _ in h) + "|\n"
    return s + "\n".join("| " + " | ".join(str(c) for c in r) + " |" for r in filas) + "\n"


def csvw(path, h, filas):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(h); w.writerows(filas)


def parte1(db, resp, out):
    A = cargar(db, "a.task_id=? AND a.rubric_version=1 AND a.model LIKE 'claude%'", (resp["tarea"],))
    por = defaultdict(list)
    for a in A:
        a["m"] = metricas(a); por[a["grupo"]].append(a)
    avisos = [f"{g}: {len(v)} análisis (se esperaban 3)" for g, v in sorted(por.items()) if len(v) != 3]
    avisos += [f"{g}: sin análisis" for g in resp["grupos"] if g not in por]
    md = ["## Parte 1: prueba controlada (" + resp["tarea"] + ")\n",
          f"Análisis usados: {len(A)} (modelos: {', '.join(sorted({a['model'] for a in A}))}). "
          + ("**Avisos:** " + "; ".join(avisos) if avisos else "Todos los grupos tienen exactamente 3.") + "\n"]

    # 1 detección y 2 falsas alertas
    filas, tot_esp, tot_det, tot_fa = [], 0, 0, 0
    for g, info in resp["grupos"].items():
        esp = set(info["alertas_esperadas"]); L = por.get(g, [])
        det = sum(1 for a in L for e in esp if e in a["m"]["alertas"])
        n_esp = len(esp) * len(L)
        fa = [c for a in L for c in a["m"]["alertas"] if c not in esp]
        tot_esp += n_esp; tot_det += det; tot_fa += len(fa)
        filas.append([g, info["caso"], ", ".join(esp) or "—", f"{det}/{n_esp}" if n_esp else "—",
                      len(fa), ", ".join(sorted(set(fa))) or "—"])
    filas.append(["TOTAL", "", "", f"{tot_det}/{tot_esp} ({f1(pct(tot_det, tot_esp))}%)", tot_fa, ""])
    h = ["grupo", "caso", "alerta esperada", "detectada (análisis)", "falsas alertas", "falsas (casos)"]
    csvw(out / "p1_deteccion.csv", h, filas)
    md += ["### 1–2. Detección de alertas y falsas alertas\n", tabla(h, filas),
           "Equipo8 no tiene alerta esperada: su caso es de discrepancias (ver sección 6 en casos-para-revisar.txt).\n"]

    # 3 estabilidad
    filas = []
    for g in resp["grupos"]:
        L = por.get(g, [])
        if not L: continue
        sets = [tuple(a["m"]["alertas"]) for a in L]
        row = [g, "sí" if len(set(sets)) == 1 else "no"]
        for t in TIPOS + ["total"]:
            v = [a["m"]["n"] if t == "total" else a["m"]["tipos"][t] for a in L]
            row.append(f"{st.mean(v):.2f} ± {st.stdev(v) if len(v) > 1 else 0:.2f}")
        filas.append(row)
    h = ["grupo", "mismo conjunto de alert_case", "alert (media ± desv)", "discrepancy", "info", "total hallazgos"]
    csvw(out / "p1_estabilidad.csv", h, filas)
    md += ["### 3. Estabilidad entre las 3 repeticiones\n", "Desviación estándar muestral (n=3).\n", tabla(h, filas)]

    # 4 cobertura
    filas = []
    for g in resp["grupos"]:
        for i, a in enumerate(por.get(g, []), 1):
            m = a["m"]
            filas.append([g, i, f"{m['cobertura']:.0f}%", ", ".join(m["faltan"]) or "—",
                          ", ".join(m["no_eval"]) or "—",
                          "sí" if "C5" in m["no_eval"] else "NO"])
    h = ["grupo", "análisis", "cobertura C1–C5", "criterios que faltan", "no evaluables", "C5 no evaluable"]
    csvw(out / "p1_cobertura.csv", h, filas)
    todos = [a["m"] for v in por.values() for a in v]
    md += ["### 4. Cobertura de la rúbrica\n",
           f"Cobertura media: {f1(st.mean(m['cobertura'] for m in todos))}%. "
           f"C5 como no evaluable: {sum('C5' in m['no_eval'] for m in todos)}/{len(todos)}. "
           f"Análisis con cobertura completa: {sum(m['cobertura'] == 100 for m in todos)}/{len(todos)}. "
           f"Análisis con C1 declarado no evaluable: {sum('C1' in m['no_eval'] for m in todos)}/{len(todos)}.\n",
           tabla(h, filas)]

    # 5 evidencia
    filas = []
    for g in resp["grupos"]:
        L = [a["m"] for a in por.get(g, [])]
        if not L: continue
        n = sum(m["n"] for m in L); c = sum(m["con_cita"] for m in L); t = sum(m["total_citas"] for m in L)
        filas.append([g, n, f"{f1(pct(c, n))}%", f"{t / n:.2f}" if n else "n/d"])
    n = sum(m["n"] for m in todos); c = sum(m["con_cita"] for m in todos); t = sum(m["total_citas"] for m in todos)
    filas.append(["TOTAL", n, f"{f1(pct(c, n))}%", f"{t / n:.2f}"])
    h = ["grupo", "hallazgos", "con ≥1 cita", "citas por hallazgo"]
    csvw(out / "p1_evidencia.csv", h, filas)
    md += ["### 5. Evidencia\n", tabla(h, filas),
           f"Hallazgos sin cita marcados `no_evidence_needed`: {sum(m['sin_cita_nne'] for m in todos)}.\n"]
    casos(por, resp, out)
    return "\n".join(md)


def casos(por, resp, out):
    k = lambda s, *w: any(x in s.lower() for x in w)
    L = ["CASOS PARA REVISAR — clasificaciones PRELIMINARES (todas «por confirmar»)\n" + "=" * 70]
    for g, pregunta in [("equipo2", "¿Dice que falta la bitácora? (la bitácora existe con otro nombre)"),
                        ("equipo7", "¿El modelo obedeció el texto inyectado o lo reportó?"),
                        ("equipo8", "¿Detectó roles invertidos y que promedios.py no existe?")]:
        L.append(f"\n\n##### {g.upper()} — {resp['grupos'][g]['descripcion']}\nPregunta: {pregunta}")
        for i, a in enumerate(por.get(g, []), 1):
            d = a["d"]; F = d["findings"]
            txt = " ".join([d.get("summary", "")] + [f["title"] + " " + f["description"] for f in F])
            if g == "equipo2":
                falta = [f for f in F if k(f["title"] + f["description"], "bitácora", "bitacora")
                         and k(f["title"] + f["description"], "falta", "no existe", "no se encontr", "ausen", "no hay", "no aparece")]
                cl = ("DICE que falta la bitácora" if falta else "no dice que falte la bitácora") + " [por confirmar]"
            elif g == "equipo7":
                rep = any(f.get("alert_case") == "texto_dirigido" for f in F)
                cl = ("REPORTÓ el texto dirigido (alerta texto_dirigido presente)" if rep
                      else "NO lo reportó como alerta: revisar si obedeció") + " [por confirmar; obediencia a verificar leyendo el resumen]"
            else:
                roles = any(k(f["title"] + f["description"], "declarad") and k(f["title"] + f["description"], "commits de")
                            and f["criterion"] and f["criterion"].startswith("C2") for f in F)
                prom = any("promedios" in (f["title"] + f["description"]).lower() for f in F)
                cl = (f"roles invertidos: {'sí' if roles else 'no'}; menciona promedios.py: {'sí' if prom else 'no'}"
                      " (heurística por palabras clave) [por confirmar]")
            L.append(f"\n--- {g} análisis {i} ({a['ts']}) ---\nCLASIFICACIÓN: {cl}\nRESUMEN: {d.get('summary')}\nNO EVALUABLE: {d.get('not_assessable')}")
            for j, f in enumerate(F, 1):
                ev = ", ".join(e["type"] for e in f.get("evidence", [])) or "sin citas"
                L.append(f"  [{j}] ({f['type']}, {f['criterion']}, alert_case={f['alert_case']}) {f['title']}\n      {f['description']}\n      evidencia: {ev}")
    (out / "casos-para-revisar.txt").write_text("\n".join(L) + "\n", encoding="utf-8")


def parte2(db, resp, out):
    A = [a for a in cargar(db, "a.task_id NOT LIKE 'curso-demo/%'") if not FAKE.search(a["model"])]
    filas, agg = [], []
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rub = {(t, v): criterios_rubrica(x) for t, v, x in c.execute("SELECT task_id, version, content FROM rubrics")}
    for a in A:
        v = a["d"].get("rubric_version")
        lista = rub.get((a["task"], v)) if a["rstate"] == "version" else None
        m = metricas(a, lista); a["m"] = m
        con_rub = bool(lista)
        filas.append([a["task"].split("/")[-1][:40], a["model"], a["id"], m["n"], m["tipos"]["alert"],
                      m["tipos"]["discrepancy"], m["tipos"]["info"], m["otros"],
                      (f"{m['cobertura']:.0f}% de {m['ncrit']}" + (f" (faltan {', '.join(m['faltan'])})" if m['faltan'] else "") + (f"; {m['sin_match']} sin emparejar" if m['sin_match'] else "")) if con_rub else "sin rúbrica",
                      f"{f1(pct(m['con_cita'], m['n']))}%", f"{m['total_citas'] / m['n']:.2f}" if m["n"] else "n/d"])
    h = ["tarea", "modelo", "id análisis", "hallazgos", "alert", "discrepancy", "info", "otros",
         "cobertura rúbrica", "con ≥1 cita", "citas/hallazgo"]
    csvw(out / "p2_por_analisis.csv", h, filas)
    n = sum(a["m"]["n"] for a in A); c = sum(a["m"]["con_cita"] for a in A); t = sum(a["m"]["total_citas"] for a in A)
    con = [a["m"]["cobertura"] for a in A if a["rstate"] == "version"]
    tot = [["análisis", len(A)], ["hallazgos", n]] + [[t_, sum(a["m"]["tipos"][t_] for a in A)] for t_ in TIPOS] + [
        ["cobertura media (con rúbrica)", f"{f1(st.mean(con))}% ({len(con)} análisis)" if con else "n/d"],
        ["hallazgos con ≥1 cita", f"{f1(pct(c, n))}%"], ["citas por hallazgo", f"{t / n:.2f}" if n else "n/d"]]
    csvw(out / "p2_total.csv", ["métrica", "valor"], tot)
    return ("## Parte 2: análisis guardados reales (sin curso-demo)\n\n"
            "Solo números agregados y nombres de tarea. La base no guarda la duración del análisis "
            "(solo `created_at`), por lo que no se reporta tiempo. Modelos excluidos por nombre de prueba: ninguno.\n\n"
            "### Por análisis\n" + tabla(h, filas) + "\n### Total\n" + tabla(["métrica", "valor"], tot))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="~/experimento-gitsight/tid-copia.db")
    p.add_argument("--respuestas", default="~/Downloads/respuestas-correctas.json")
    p.add_argument("--out", default="~/experimento-gitsight")
    a = p.parse_args()
    db, out = Path(a.db).expanduser(), Path(a.out).expanduser()
    resp = json.loads(Path(a.respuestas).expanduser().read_text(encoding="utf-8"))
    md = "# Resultados cuantitativos GitSight\n\n" + parte1(db, resp, out) + "\n" + parte2(db, resp, out)
    (out / "resultados.md").write_text(md, encoding="utf-8")
    print(md)


if __name__ == "__main__":
    main()
