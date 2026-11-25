import type { Finding, FindingType } from "../types/analyze";

/** Orden en que se muestran los tipos (de más a menos importante). */
export const FINDING_TYPES: FindingType[] = ["alert", "discrepancy", "info"];

export const TYPE_PLURAL: Record<FindingType, string> = {
  alert: "Alertas",
  discrepancy: "Discrepancias",
  info: "Información",
};

export type TypeCounts = Record<FindingType, number>;

export function countByType(findings: readonly Finding[]): TypeCounts {
  const counts: TypeCounts = { alert: 0, discrepancy: 0, info: 0 };
  for (const f of findings) counts[f.type] += 1;
  return counts;
}

/** Criterios en el orden en que aparecen; los hallazgos generales (criterion null) van aparte. */
export function groupFindings(findings: readonly Finding[]) {
  const byCriterion = new Map<string, Finding[]>();
  const general: Finding[] = [];
  for (const finding of findings) {
    if (finding.criterion === null) {
      general.push(finding);
    } else {
      const list = byCriterion.get(finding.criterion) ?? [];
      list.push(finding);
      byCriterion.set(finding.criterion, list);
    }
  }
  return { criteria: [...byCriterion.entries()], general };
}

/**
 * Hallazgos que quedan con el filtro por tipo. Un filtro vacío significa «todos». Los criterios
 * que se quedan sin hallazgos se ocultan; `total` es 0 cuando el filtro deja todo vacío.
 */
export function visibleFindings(findings: readonly Finding[], active: ReadonlySet<FindingType>) {
  const shown = active.size === 0 ? findings : findings.filter((f) => active.has(f.type));
  const { criteria, general } = groupFindings(shown);
  return { criteria, general, total: shown.length };
}

/** Criterios abiertos por defecto: los que tienen al menos una alerta. */
export function defaultOpenCriteria(criteria: readonly (readonly [string, readonly Finding[]])[]): Set<string> {
  return new Set(criteria.filter(([, findings]) => findings.some((f) => f.type === "alert")).map(([name]) => name));
}

/** Texto cuando el filtro no deja ningún hallazgo. */
export function emptyFilterText(active: ReadonlySet<FindingType>): string {
  const names = FINDING_TYPES.filter((t) => active.has(t)).map((t) => TYPE_PLURAL[t].toLowerCase());
  return `Este análisis no tiene ${names.join(" ni ")}. Quita el filtro para ver todos los hallazgos.`;
}

/** Activa o desactiva un tipo del filtro, sin modificar el conjunto recibido. */
export function toggleType(active: ReadonlySet<FindingType>, type: FindingType): Set<FindingType> {
  const next = new Set(active);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  return next;
}
