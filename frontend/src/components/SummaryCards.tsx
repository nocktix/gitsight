import type { GroupSummary } from "../utils/commitTime";
import "./SummaryCards.css";

export default function SummaryCards({ summary }: { summary: GroupSummary }) {
  const cards = [
    { label: "Commits", value: String(summary.totalCommits), late: false },
    { label: "Días activos", value: String(summary.activeDays), late: false },
    {
      label: "Hora pico",
      value: summary.peakHour === null ? "—" : `${summary.peakHour}:00–${summary.peakHour + 1}:00`,
      late: false,
    },
    {
      label: "Fuera de plazo",
      value: String(summary.lateCommits),
      late: summary.lateCommits > 0,
    },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card) => (
        <div className="summary-cards__card" key={card.label}>
          <span className="summary-cards__label">{card.label}</span>
          <span
            className={
              card.late
                ? "summary-cards__value summary-cards__value--late"
                : "summary-cards__value"
            }
          >
            {card.value}
          </span>
        </div>
      ))}
    </div>
  );
}
