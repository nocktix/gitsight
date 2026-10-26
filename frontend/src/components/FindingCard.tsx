import type { ReactNode } from "react";
import { useEvidence } from "../context/useEvidence";
import type { Finding, FindingType } from "../types/analyze";
import { citedCommits, evidenceLabel, showNoEvidenceLabel } from "../utils/evidence";
import "./FindingCard.css";

const TYPE_LABEL: Record<FindingType, string> = {
  info: "Información",
  discrepancy: "Discrepancia",
  alert: "Alerta",
};

/**
 * Un ícono de silueta propia por tipo (círculo, triángulo y octágono), para distinguirlos sin
 * depender del color. Usan currentColor, así que toman el color del texto de la tarjeta.
 */
const ICON_SHAPE: Record<FindingType, ReactNode> = {
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.6v.01" />
    </>
  ),
  discrepancy: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.3v.01" />
    </>
  ),
  alert: (
    <>
      <path d="M9 3h6l6 6v6l-6 6H9l-6-6V9z" />
      <path d="m9.5 9.5 5 5m0-5-5 5" />
    </>
  ),
};

function TypeIcon({ type }: { type: FindingType }) {
  return (
    <svg
      aria-label={TYPE_LABEL[type]}
      className="finding-card__icon"
      fill="none"
      height="20"
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <title>{TYPE_LABEL[type]}</title>
      {ICON_SHAPE[type]}
    </svg>
  );
}

export default function FindingCard({ finding }: { finding: Finding }) {
  const { setHighlighted, openCommitFromEvidence, openViewer } = useEvidence();
  const evidence = finding.evidence ?? [];
  const highlight = () => setHighlighted(citedCommits(finding));
  const clear = () => setHighlighted(null);

  return (
    <div
      className={`finding-card finding-card--${finding.type}`}
      onBlur={clear}
      onFocus={highlight}
      onMouseEnter={highlight}
      onMouseLeave={clear}
    >
      <TypeIcon type={finding.type} />
      <div className="finding-card__body">
        <p className="finding-card__title">{finding.title}</p>
        <p className="finding-card__description">{finding.description}</p>
        {evidence.length > 0 && (
          <ul aria-label="Evidencia" className="finding-card__evidence" data-tour="evidence">
            {evidence.map((ref, i) => (
              <li key={i}>
                <button
                  className={`finding-card__chip finding-card__chip--${ref.type}`}
                  onClick={() =>
                    ref.type === "commit"
                      ? openCommitFromEvidence(ref.hash)
                      : openViewer({ kind: ref.type, lineStart: ref.line_start, lineEnd: ref.line_end })
                  }
                  title={ref.type === "commit" ? "Ver el commit y sus cambios" : "Ver las líneas citadas"}
                  type="button"
                >
                  {evidenceLabel(ref)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {showNoEvidenceLabel(finding) && (
          <p className="finding-card__no-evidence">sin evidencia vinculada</p>
        )}
      </div>
    </div>
  );
}
