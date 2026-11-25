import { DEMO_REPO_URL, recentLabel } from "../utils/recentGroups";
import type { RecentGroup } from "../utils/recentGroups";
import "./QuickAccess.css";

interface Props {
  recent: RecentGroup[];
  disabled: boolean;
  onOpenRecent: (group: RecentGroup) => void;
  onDemo: () => void;
}

/** Chips bajo las tarjetas: volver a los últimos grupos abiertos y probar con la demo. */
export default function QuickAccess({ recent, disabled, onOpenRecent, onDemo }: Props) {
  return (
    <div className="quick-access">
      {recent.length > 0 && <span className="quick-access__label">Seguir donde quedaste:</span>}
      {recent.map((g) => (
        <button
          className="quick-access__chip"
          disabled={disabled}
          key={g.groupUrl}
          onClick={() => onOpenRecent(g)}
          title={`${g.taskId} · ${g.name}`}
          type="button"
        >
          {recentLabel(g)}
        </button>
      ))}
      <button
        className="quick-access__chip quick-access__chip--demo"
        disabled={disabled}
        onClick={onDemo}
        title={DEMO_REPO_URL}
        type="button"
      >
        Probar con la demo
      </button>
    </div>
  );
}
