import { useMemo } from "react";
import { useEvidence } from "../context/useEvidence";
import type { CommitPoint } from "../types/commits";
import {
  formatCommits,
  formatDayFull,
  formatLines,
  intensityLevel,
  isAfterDeadline,
  statsByDay,
} from "../utils/commitTime";
import ContributorRow from "./ContributorRow";
import "./ContributorCalendar.css";

/** Fila de un contribuidor: un cuadrado por día, con las mismas columnas que las demás filas. */
export default function ContributorCalendar({
  author,
  commits,
  days,
  endKey,
  group = false,
  maxCount,
  onSelectDay,
  startKey,
  stats: statsText,
}: {
  author: string;
  commits: CommitPoint[];
  days: string[];
  endKey: string | null;
  /** Fila resumen del grupo (mismos cuadrados, escala propia). */
  group?: boolean;
  /** Máximo de commits en un día entre todos los contribuidores (escala compartida). */
  maxCount: number;
  onSelectDay: (dayKey: string) => void;
  startKey: string | null;
  /** Texto bajo el nombre; por defecto, commits y líneas. */
  stats?: string;
}) {
  const stats = useMemo(() => statsByDay(commits), [commits]);
  const totalLines = commits.reduce((sum, c) => sum + c.totalLines, 0);
  // Días con algún commit que cita el hallazgo bajo el mouse.
  const { highlighted } = useEvidence();
  const citedDays = useMemo(
    () => new Set(highlighted ? commits.filter((c) => highlighted.has(c.hash)).map((c) => c.dayKey) : []),
    [commits, highlighted],
  );

  return (
    <ContributorRow
      author={author}
      group={group}
      stats={statsText ?? `${formatCommits(commits.length)} · ${formatLines(totalLines)}`}
    >
      <div
        className="contributor-calendar"
        style={{ gridTemplateColumns: `repeat(${days.length}, var(--cell))` }}
      >
        {days.map((dayKey) => {
          const day = stats.get(dayKey);
          const count = day?.commits ?? 0;
          const classes = [
            "contributor-calendar__cell",
            `contributor-calendar__cell--l${intensityLevel(count, maxCount)}`,
          ];
          if (isAfterDeadline(dayKey, endKey)) classes.push("contributor-calendar__cell--late");
          if (startKey && dayKey < startKey) classes.push("contributor-calendar__cell--before");
          if (dayKey === startKey) classes.push("contributor-calendar__cell--start");
          if (dayKey === endKey) classes.push("contributor-calendar__cell--end");
          if (highlighted) {
            classes.push(citedDays.has(dayKey) ? "contributor-calendar__cell--cited" : "contributor-calendar__cell--dim");
          }
          return (
            <button
              className={classes.join(" ")}
              disabled={count === 0}
              key={dayKey}
              onClick={() => onSelectDay(dayKey)}
              title={
                day
                  ? `${author} · ${formatDayFull(dayKey)} · ${formatCommits(day.commits)} · ${formatLines(day.lines)}`
                  : undefined
              }
              type="button"
            />
          );
        })}
      </div>
    </ContributorRow>
  );
}
