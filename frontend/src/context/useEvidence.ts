import { createContext, useContext } from "react";
import type { ArtifactKind } from "../utils/evidence";

export interface ArtifactView {
  kind: ArtifactKind;
  lineStart: number;
  lineEnd: number;
}

export interface EvidenceValue {
  /** Hashes completos que cita el hallazgo bajo el mouse; null = nada resaltado. */
  highlighted: ReadonlySet<string> | null;
  setHighlighted: (hashes: ReadonlySet<string> | null) => void;
  /** Commit abierto en el panel de detalle. */
  selectedCommit: string | null;
  /** Abre el panel de un commit (clic en el calendario). */
  openCommit: (hash: string) => void;
  /** Abre el panel y pide al calendario que muestre el día del commit (clic en un chip). */
  openCommitFromEvidence: (hash: string) => void;
  closeCommit: () => void;
  /** Petición de ir al día de un commit; `nonce` distingue peticiones repetidas del mismo commit. */
  focusRequest: { hash: string; nonce: number } | null;
  viewer: ArtifactView | null;
  openViewer: (view: ArtifactView) => void;
  closeViewer: () => void;
}

export const EvidenceContext = createContext<EvidenceValue | null>(null);

export function useEvidence(): EvidenceValue {
  const value = useContext(EvidenceContext);
  if (!value) throw new Error("useEvidence debe usarse dentro de EvidenceProvider");
  return value;
}
