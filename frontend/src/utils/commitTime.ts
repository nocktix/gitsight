import type { CommitPoint, CommitsData, Contributor } from "../types/commits";

/**
 * Todas las fechas se manejan como "YYYY-MM-DD" (día de calendario de Chile) y la hora como
 * minutos del día. El backend entrega `authoredAt` ya en America/Santiago, así que se lee del
 * texto sin pasar por `Date`: el resultado no depende de la zona horaria del navegador.
 */

const AUTHORED_AT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function parseAuthoredAt(value: string): { dayKey: string; minutesOfDay: number } {
  const match = AUTHORED_AT_RE.exec(value);
  if (!match) throw new Error(`Fecha de commit inválida: ${value}`);
  return { dayKey: match[1], minutesOfDay: Number(match[2]) * 60 + Number(match[3]) };
}

function utcMs(dayKey: string): number {
  const match = DAY_KEY_RE.exec(dayKey);
  if (!match) throw new Error(`Día inválido: ${dayKey}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function keyFromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Día de calendario de una fecha local (las fechas de la tarea se parsean como fecha local a las 00:00). */
export function dayKeyOfLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(dayKey: string, days: number): string {
  return keyFromUtcMs(utcMs(dayKey) + days * MS_PER_DAY);
}

/** 0 = lunes … 6 = domingo. */
export function weekdayIndex(dayKey: string): number {
  return (new Date(utcMs(dayKey)).getUTCDay() + 6) % 7;
}

/**
 * Único criterio de "posterior a la entrega": el commit cae en un día posterior al día de
 * entrega. Los commits del propio día de entrega son a tiempo. Sin entrega, nada es tardío.
 */
export function isAfterDeadline(dayKey: string, deadlineDayKey: string | null): boolean {
  return deadlineDayKey !== null && dayKey > deadlineDayKey;
}

/** "martes 16 de septiembre" */
export function formatDayLong(dayKey: string): string {
  const date = new Date(utcMs(dayKey));
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]}`;
}

/** "16/09" */
export function formatDayShort(dayKey: string): string {
  return `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`;
}

const MONTHS_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Encabezado de una columna: "25 may" en el primer día y el día 1, solo el número en cada lunes; null en el resto. */
export function dayHeaderLabel(dayKey: string, isFirst: boolean): string | null {
  const day = Number(dayKey.slice(8, 10));
  if (isFirst || day === 1) return `${day} ${MONTHS_SHORT[Number(dayKey.slice(5, 7)) - 1]}`;
  return weekdayIndex(dayKey) === 0 ? String(day) : null;
}

export function formatCommits(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`;
}

export function formatLines(count: number): string {
  return `${count} ${count === 1 ? "línea" : "líneas"}`;
}

/** "16/09/2025" */
export function formatDayFull(dayKey: string): string {
  return `${formatDayShort(dayKey)}/${dayKey.slice(0, 4)}`;
}

export interface Activity {
  /** Con al menos un commit de trabajo (no merge), ordenados por nombre. */
  contributors: Contributor[];
  /** Autores cuyos únicos commits son merges. */
  mergeOnly: string[];
}

export function buildActivity(data: CommitsData): Activity {
  const byName = (a: string, b: string) => a.localeCompare(b, "es", { sensitivity: "base" });
  const contributors: Contributor[] = [];
  const mergeOnly: string[] = [];

  for (const author of Object.keys(data.authorDailyContributionsMap).sort(byName)) {
    const commits: CommitPoint[] = [];
    for (const day of data.authorDailyContributionsMap[author] ?? []) {
      for (const commit of day.commitResults) {
        if (commit.isMergeCommit) continue;

        let insertions = 0;
        let deletions = 0;
        for (const contribution of Object.values(commit.fileTypesAndContributionMap)) {
          insertions += contribution.insertions;
          deletions += contribution.deletions;
        }
        commits.push({
          hash: commit.hash,
          messageTitle: commit.messageTitle,
          ...parseAuthoredAt(commit.authoredAt),
          insertions,
          deletions,
          totalLines: insertions + deletions,
        });
      }
    }
    commits.sort((a, b) =>
      a.dayKey === b.dayKey ? a.minutesOfDay - b.minutesOfDay : a.dayKey.localeCompare(b.dayKey),
    );
    if (commits.length > 0) contributors.push({ author, commits });
    else mergeOnly.push(author);
  }

  return { contributors, mergeOnly };
}

export interface CalendarRange {
  /** Lunes de la primera semana. */
  firstDay: string;
  /** Domingo de la última semana. */
  lastDay: string;
  /** Un elemento por día, de `firstDay` a `lastDay`. */
  days: string[];
}

/**
 * Ventana del calendario: del lunes de la semana de inicio al domingo de la semana de entrega.
 * Se extiende hacia atrás (lunes de la semana del primer commit) si hay commits anteriores al
 * inicio, y hacia adelante (domingo de la semana del último commit) si hay posteriores a la
 * entrega. Sin fechas, se usan los commits; si falta una sola, se completa con ellos.
 */
export function calendarRange(
  commitDays: string[],
  startKey: string | null,
  endKey: string | null,
): CalendarRange | null {
  const sorted = [...commitDays].sort();
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;

  const from = startKey ? (first && first < startKey ? first : startKey) : (first ?? endKey);
  const deadline = endKey ?? last ?? startKey;
  if (!from || !deadline) return null;
  const to = last && last > deadline ? last : deadline;

  const firstDay = addDays(from, -weekdayIndex(from));
  const lastDay = addDays(to, 6 - weekdayIndex(to));
  const days: string[] = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) days.push(d);
  return { firstDay, lastDay, days };
}

/** 0 = sin commits; 1–4 según la proporción respecto al máximo compartido por todos. */
export function intensityLevel(count: number, maxCount: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4))) as 1 | 2 | 3 | 4;
}

export interface DayStats {
  commits: number;
  lines: number;
}

export function statsByDay(commits: CommitPoint[]): Map<string, DayStats> {
  const map = new Map<string, DayStats>();
  for (const commit of commits) {
    const stats = map.get(commit.dayKey) ?? { commits: 0, lines: 0 };
    stats.commits += 1;
    stats.lines += commit.totalLines;
    map.set(commit.dayKey, stats);
  }
  return map;
}

/**
 * Actividad por día de todo el grupo: suma de los integrantes ya filtrados por `buildActivity`
 * (sin merges ni autores excluidos), así que cuadra exactamente con las filas individuales.
 */
export function groupStatsByDay(contributors: Contributor[]): Map<string, DayStats> {
  return statsByDay(contributors.flatMap((c) => c.commits));
}

export function formatMembers(count: number): string {
  return `${count} ${count === 1 ? "integrante" : "integrantes"}`;
}

export interface GroupSummary {
  totalCommits: number;
  activeDays: number;
  /** Hora del día (0–23) con más commits; null si no hay commits. Ante empate, la más temprana. */
  peakHour: number | null;
  lateCommits: number;
}

export function summarize(commits: CommitPoint[], deadlineDayKey: string | null): GroupSummary {
  const days = new Set<string>();
  const perHour = new Array<number>(24).fill(0);
  let lateCommits = 0;

  for (const commit of commits) {
    days.add(commit.dayKey);
    perHour[Math.floor(commit.minutesOfDay / 60)] += 1;
    if (isAfterDeadline(commit.dayKey, deadlineDayKey)) lateCommits += 1;
  }

  let peakHour: number | null = null;
  let peakCount = 0;
  perHour.forEach((count, hour) => {
    if (count > peakCount) {
      peakCount = count;
      peakHour = hour;
    }
  });

  return { totalCommits: commits.length, activeDays: days.size, peakHour, lateCommits };
}
