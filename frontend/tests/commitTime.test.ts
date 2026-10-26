import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  buildActivity,
  calendarRange,
  dayHeaderLabel,
  formatCommits,
  formatLines,
  formatDayLong,
  groupStatsByDay,
  statsByDay,
  intensityLevel,
  isAfterDeadline,
  parseAuthoredAt,
  summarize,
  weekdayIndex,
} from "../src/utils/commitTime.ts";

test("authoredAt se lee tal cual, sin convertir por la zona del navegador", () => {
  assert.deepEqual(parseAuthoredAt("2025-09-16T23:59:30-03:00"), {
    dayKey: "2025-09-16",
    minutesOfDay: 23 * 60 + 59,
  });
  assert.deepEqual(parseAuthoredAt("2025-09-16T00:05:00-04:00"), {
    dayKey: "2025-09-16",
    minutesOfDay: 5,
  });
});

test("isAfterDeadline: el día de entrega es a tiempo, el siguiente es tardío", () => {
  assert.equal(isAfterDeadline("2025-09-16", "2025-09-16"), false);
  assert.equal(isAfterDeadline("2025-09-15", "2025-09-16"), false);
  assert.equal(isAfterDeadline("2025-09-17", "2025-09-16"), true);
  assert.equal(isAfterDeadline("2025-09-17", null), false);
});

test("fechas en español y semanas de lunes a domingo", () => {
  assert.equal(formatDayLong("2025-09-16"), "martes 16 de septiembre");
  assert.equal(weekdayIndex("2025-09-15"), 0);
  assert.equal(weekdayIndex("2025-09-21"), 6);
  assert.equal(addDays("2025-12-30", 3), "2026-01-02");
});

test("calendarRange con commits solo dentro de la ventana termina el domingo de la semana de entrega", () => {
  // Lunes 25/05 de inicio, todos los commits y la entrega el miércoles 27/05.
  const r = calendarRange(["2026-05-27", "2026-05-27"], "2026-05-25", "2026-05-27")!;
  assert.equal(r.firstDay, "2026-05-25");
  assert.equal(r.lastDay, "2026-05-31");
  assert.equal(r.days.length, 7);
});

test("calendarRange con commits anteriores al inicio empieza el lunes de la semana del primer commit", () => {
  // Inicio miércoles 27/05; primer commit el jueves 14/05 (semana del lunes 11/05).
  const r = calendarRange(["2026-05-14", "2026-05-28"], "2026-05-27", "2026-05-29")!;
  assert.equal(r.firstDay, "2026-05-11");
  assert.equal(r.lastDay, "2026-05-31");
  assert.equal(r.days.length, 21);
  // Un commit en la misma semana del inicio no la extiende.
  assert.equal(calendarRange(["2026-05-26"], "2026-05-27", "2026-05-29")!.firstDay, "2026-05-25");
});

test("calendarRange se extiende solo si hay commits posteriores a la semana de entrega", () => {
  const r = calendarRange(["2025-09-16", "2025-10-02"], "2025-09-17", "2025-09-24")!;
  assert.equal(r.lastDay, "2025-10-05");
  assert.equal(r.days.length, 21);
});

test("calendarRange sin fechas usa el primer y último commit", () => {
  const r = calendarRange(["2025-09-17", "2025-09-24"], null, null)!;
  assert.equal(r.firstDay, "2025-09-15");
  assert.equal(r.lastDay, "2025-09-28");
  assert.equal(calendarRange([], null, null), null);
});

test("encabezados de columna: primer día, lunes y día 1 con mes", () => {
  assert.equal(dayHeaderLabel("2026-05-25", true), "25 may");
  assert.equal(dayHeaderLabel("2026-05-26", false), null);
  assert.equal(dayHeaderLabel("2026-06-01", false), "1 jun");
  assert.equal(dayHeaderLabel("2026-06-08", false), "8");
});

test("singular y plural", () => {
  assert.equal(formatCommits(1), "1 commit");
  assert.equal(formatCommits(0), "0 commits");
  assert.equal(formatLines(1), "1 línea");
  assert.equal(formatLines(589), "589 líneas");
});

test("intensityLevel: 0 vacío y 4 niveles con máximo compartido", () => {
  assert.equal(intensityLevel(0, 10), 0);
  assert.equal(intensityLevel(1, 10), 1);
  assert.equal(intensityLevel(5, 10), 2);
  assert.equal(intensityLevel(8, 10), 4);
  assert.equal(intensityLevel(10, 10), 4);
});

function commit(hash: string, authoredAt: string, merge = false) {
  return {
    hash,
    isMergeCommit: merge,
    authoredAt,
    messageTitle: hash,
    messageBody: "",
    fileTypesAndContributionMap: { ts: { insertions: 3, deletions: 1 } },
  };
}

const data = {
  authorDailyContributionsMap: {
    Ana: [
      { date: "2025-09-16T00:00:00", commitResults: [commit("a1", "2025-09-16T10:15:00-03:00")] },
      { date: "2025-09-17T00:00:00", commitResults: [commit("a2", "2025-09-17T10:40:00-03:00")] },
    ],
    Beto: [
      { date: "2025-09-16T00:00:00", commitResults: [commit("b1", "2025-09-16T22:00:00-03:00")] },
    ],
    Carla: [
      { date: "2025-09-16T00:00:00", commitResults: [commit("m1", "2025-09-16T09:00:00-03:00", true)] },
    ],
  },
  authorFileTypeContributionMap: {},
  authorContributionVariance: {},
  authorDisplayNameMap: {},
};

test("buildActivity separa a quienes solo tienen merges", () => {
  const { contributors, mergeOnly } = buildActivity(data);
  assert.deepEqual(contributors.map((c) => c.author), ["Ana", "Beto"]);
  assert.deepEqual(mergeOnly, ["Carla"]);
  assert.equal(contributors[0].commits[0].totalLines, 4);
});

test("summarize: calendario, tarjeta y triángulos comparten isAfterDeadline", () => {
  const all = buildActivity(data).contributors.flatMap((c) => c.commits);
  const s = summarize(all, "2025-09-16");
  assert.equal(s.totalCommits, 3);
  assert.equal(s.activeDays, 2);
  assert.equal(s.peakHour, 10);
  assert.equal(s.lateCommits, 1);
  assert.equal(
    s.lateCommits,
    all.filter((c) => isAfterDeadline(c.dayKey, "2025-09-16")).length,
  );
  assert.equal(summarize(all, null).lateCommits, 0);
  assert.equal(summarize([], null).peakHour, null);
});

test("groupStatsByDay: la fila del grupo es la suma de los integrantes, día por día", () => {
  const pt = (dayKey: string, totalLines: number) => ({
    hash: `${dayKey}-${totalLines}`, messageTitle: "", dayKey, minutesOfDay: 600,
    insertions: totalLines, deletions: 0, totalLines,
  });
  const contributors = [
    { author: "a", commits: [pt("2026-05-25", 10), pt("2026-05-25", 5), pt("2026-05-26", 1)] },
    { author: "b", commits: [pt("2026-05-25", 20), pt("2026-05-27", 7)] },
  ];
  const group = groupStatsByDay(contributors);
  const days = new Set(contributors.flatMap((c) => c.commits.map((x) => x.dayKey)));
  for (const day of days) {
    const sum = contributors.reduce(
      (acc, c) => {
        const s = statsByDay(c.commits).get(day);
        return { commits: acc.commits + (s?.commits ?? 0), lines: acc.lines + (s?.lines ?? 0) };
      },
      { commits: 0, lines: 0 },
    );
    assert.deepEqual(group.get(day), sum);
  }
  assert.deepEqual(group.get("2026-05-25"), { commits: 3, lines: 35 });
  assert.equal(group.size, days.size);
});
