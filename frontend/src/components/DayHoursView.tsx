import type { Contributor } from "../types/commits";
import { formatCommits, formatDayLong, formatLines } from "../utils/commitTime";
import ContributorRow from "./ContributorRow";
import RampChartSvg from "./RampChartSvg";
import "./DayHoursView.css";

export default function DayHoursView({
  contributors,
  dayKey,
  deadlineDayKey,
  maxLines,
  onBack,
  onCommitClick,
  selectedAuthor,
}: {
  contributors: Contributor[];
  dayKey: string;
  deadlineDayKey: string | null;
  maxLines: number;
  onBack: () => void;
  onCommitClick: (hash: string) => void;
  /** Contribuidor cuyo cuadrado se tocó: su fila queda destacada. null = fila del grupo (todos). */
  selectedAuthor: string | null;
}) {
  const rows = contributors.map(({ author, commits }) => ({
    author,
    commits: commits.filter((c) => c.dayKey === dayKey),
  }));
  const total = rows.reduce((sum, row) => sum + row.commits.length, 0);

  return (
    <div className="day-hours">
      <div className="day-hours__header">
        <button className="day-hours__back" onClick={onBack} type="button">
          ← Calendario
        </button>
        <h3 className="day-hours__title">{formatDayLong(dayKey)}</h3>
        <span className="day-hours__count">{formatCommits(total)}</span>
      </div>
      <p className="day-hours__hint">Haz clic en un triángulo para ver el diff del commit</p>

      <div className="day-hours__rows">
        {rows.map((row) => {
          const highlighted = selectedAuthor === null || row.author === selectedAuthor;
          const lines = row.commits.reduce((sum, c) => sum + c.totalLines, 0);
          return (
            <ContributorRow
              author={row.author}
              dimmed={!highlighted}
              key={row.author}
              stats={`${formatCommits(row.commits.length)} · ${formatLines(lines)}`}
            >
              {row.commits.length === 0 ? (
                <p className="contributor-row__empty">Sin commits este día</p>
              ) : (
                <RampChartSvg
                  commits={row.commits}
                  dayKey={dayKey}
                  deadlineDayKey={deadlineDayKey}
                  highlighted={highlighted}
                  maxLines={maxLines}
                  onCommitClick={onCommitClick}
                />
              )}
            </ContributorRow>
          );
        })}
      </div>
    </div>
  );
}
