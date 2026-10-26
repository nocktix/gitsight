import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { EvidenceContext } from "./useEvidence";
import type { ArtifactView, EvidenceValue } from "./useEvidence";


/** Estado compartido entre los hallazgos, el calendario, el panel de commit y el visor de archivos. */
export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState<ReadonlySet<string> | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<EvidenceValue["focusRequest"]>(null);
  const [viewer, setViewer] = useState<ArtifactView | null>(null);

  const openCommit = useCallback((hash: string) => setSelectedCommit(hash), []);
  const openCommitFromEvidence = useCallback((hash: string) => {
    setFocusRequest((prev) => ({ hash, nonce: (prev?.nonce ?? 0) + 1 }));
    setSelectedCommit(hash);
  }, []);
  const closeCommit = useCallback(() => setSelectedCommit(null), []);
  const closeViewer = useCallback(() => setViewer(null), []);

  return (
    <EvidenceContext.Provider
      value={{
        highlighted,
        setHighlighted,
        selectedCommit,
        openCommit,
        openCommitFromEvidence,
        closeCommit,
        focusRequest,
        viewer,
        openViewer: setViewer,
        closeViewer,
      }}
    >
      {children}
    </EvidenceContext.Provider>
  );
}
