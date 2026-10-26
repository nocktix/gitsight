import { useState } from "react";
import { useEvidence } from "../context/useEvidence";
import { useContainerWidth } from "../hooks/useContainerWidth";
import type { CommitPoint } from "../types/commits";
import { formatDayFull, formatLines, isAfterDeadline } from "../utils/commitTime";
import "./RampChartSvg.css";

const HEIGHT = 66;
const BASELINE_Y = 46;
const PADDING_X = 16;
const MIN_TRIANGLE_HEIGHT = 8;
const MAX_TRIANGLE_HEIGHT = 28;
const AXIS_LABEL_Y = 62;
const AXIS_TICK_STEP_HOURS = 3;
const DEFAULT_WIDTH = 800;
const MINUTES_PER_DAY = 24 * 60;
/** La entrega vence a las 23:59 del día de entrega (mismo criterio que el backend). */
const DEADLINE_MINUTES = MINUTES_PER_DAY - 1;
const DEADLINE_LABEL_Y = 10;

function xForMinutes(minutes: number, width: number): number {
  return PADDING_X + (minutes / MINUTES_PER_DAY) * (width - 2 * PADDING_X);
}

/** Alto según la raíz cuadrada de las líneas; el ancho es igual al alto (proporción fija). */
function sizeForLines(totalLines: number, maxLines: number): number {
  if (maxLines <= 0 || totalLines <= 0) return MIN_TRIANGLE_HEIGHT;
  const t = Math.sqrt(totalLines / maxLines);
  return MIN_TRIANGLE_HEIGHT + t * (MAX_TRIANGLE_HEIGHT - MIN_TRIANGLE_HEIGHT);
}

function formatTime(minutesOfDay: number): string {
  const hours = String(Math.floor(minutesOfDay / 60)).padStart(2, "0");
  const minutes = String(minutesOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

const TICK_HOURS = Array.from(
  { length: 24 / AXIS_TICK_STEP_HOURS + 1 },
  (_, i) => i * AXIS_TICK_STEP_HOURS,
);

interface TooltipState {
  commit: CommitPoint;
  left: number;
  top: number;
}

/** Ramp chart de un solo día: eje X de 0:00 a 24:00, cada commit en su hora real. */
export default function RampChartSvg({
  commits,
  dayKey,
  deadlineDayKey,
  highlighted,
  maxLines,
  onCommitClick,
}: {
  commits: CommitPoint[];
  /** Día que se muestra. */
  dayKey: string;
  deadlineDayKey: string | null;
  highlighted: boolean;
  maxLines: number;
  onCommitClick: (hash: string) => void;
}) {
  const [wrapperRef, width] = useContainerWidth(DEFAULT_WIDTH);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const { highlighted: cited } = useEvidence();

  const handlePoint =
    (commit: CommitPoint) => (event: React.MouseEvent<SVGPolygonElement>) => {
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!wrapperRect) return;
      setTooltip({
        commit,
        left: event.clientX - wrapperRect.left,
        top: event.clientY - wrapperRect.top,
      });
    };

  return (
    <div className="ramp-chart-svg" ref={wrapperRef}>
      <svg
        className="ramp-chart-svg__svg"
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
      >
        <line
          className={
            highlighted
              ? "ramp-chart-svg__timeline ramp-chart-svg__timeline--highlighted"
              : "ramp-chart-svg__timeline"
          }
          x1={PADDING_X}
          x2={width - PADDING_X}
          y1={BASELINE_Y}
          y2={BASELINE_Y}
        />

        {commits.map((commit) => {
          const x = xForMinutes(commit.minutesOfDay, width);
          const h = sizeForLines(commit.totalLines, maxLines);
          const points = `${x - h / 2},${BASELINE_Y} ${x + h / 2},${BASELINE_Y} ${x},${
            BASELINE_Y - h
          }`;
          const classes = ["ramp-chart-svg__triangle"];
          if (isAfterDeadline(commit.dayKey, deadlineDayKey)) classes.push("ramp-chart-svg__triangle--late");
          if (cited) {
            classes.push(cited.has(commit.hash) ? "ramp-chart-svg__triangle--cited" : "ramp-chart-svg__triangle--dim");
          }
          return (
            <polygon
              className={classes.join(" ")}
              key={commit.hash}
              onClick={() => onCommitClick(commit.hash)}
              onMouseEnter={handlePoint(commit)}
              onMouseLeave={() => setTooltip(null)}
              onMouseMove={handlePoint(commit)}
              points={points}
            />
          );
        })}

        {dayKey === deadlineDayKey && (
          <>
            <line
              className="ramp-chart-svg__deadline"
              x1={xForMinutes(DEADLINE_MINUTES, width)}
              x2={xForMinutes(DEADLINE_MINUTES, width)}
              y1={0}
              y2={BASELINE_Y + 4}
            />
            <text
              className="ramp-chart-svg__deadline-label"
              textAnchor="end"
              x={xForMinutes(DEADLINE_MINUTES, width) - 4}
              y={DEADLINE_LABEL_Y}
            >
              Entrega
            </text>
          </>
        )}

        {TICK_HOURS.map((hour) => (
          <text
            className="ramp-chart-svg__tick"
            key={hour}
            textAnchor="middle"
            x={xForMinutes(hour * 60, width)}
            y={AXIS_LABEL_Y}
          >
            {`${hour}:00`}
          </text>
        ))}
      </svg>

      {tooltip && (
        <div
          className="ramp-chart-svg__tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <p className="ramp-chart-svg__tooltip-hash">
            {tooltip.commit.hash.slice(0, 7)}
          </p>
          <p className="ramp-chart-svg__tooltip-title">
            {tooltip.commit.messageTitle}
          </p>
          <p className="ramp-chart-svg__tooltip-lines">
            +{tooltip.commit.insertions} −{tooltip.commit.deletions} · {formatLines(tooltip.commit.totalLines)}
          </p>
          <p className="ramp-chart-svg__tooltip-date">
            {formatDayFull(tooltip.commit.dayKey)} {formatTime(tooltip.commit.minutesOfDay)}
          </p>
        </div>
      )}
    </div>
  );
}
