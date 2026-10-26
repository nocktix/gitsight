import { dayHeaderLabel, weekdayIndex } from "../utils/commitTime";
import "./CalendarHeader.css";

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

/** Dos líneas alineadas con las columnas: número de día (con mes cuando corresponde) e inicial del día de la semana. */
export default function CalendarHeader({ days }: { days: string[] }) {
  const columns = { gridTemplateColumns: `repeat(${days.length}, var(--cell))` };

  return (
    <div className="calendar-header">
      <div className="calendar-header__line" style={columns}>
        {days.map((day, i) => (
          <span className="calendar-header__date" key={day}>
            {dayHeaderLabel(day, i === 0)}
          </span>
        ))}
      </div>
      <div className="calendar-header__line" style={columns}>
        {days.map((day) => (
          <span className="calendar-header__weekday" key={day}>
            {WEEKDAY_INITIALS[weekdayIndex(day)]}
          </span>
        ))}
      </div>
    </div>
  );
}
