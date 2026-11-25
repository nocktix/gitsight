import { Fragment, useEffect } from "react";
import { BackendNotices, BackendStatusScreen } from "./components/BackendNotices";
import ArtifactViewer from "./components/ArtifactViewer";
import CommitDetailPanel from "./components/CommitDetailPanel";
import { TourLauncher } from "./components/Tour";
import TopBar from "./components/TopBar";
import GroupWorkspace from "./components/GroupWorkspace";
import LlmSettings from "./components/LlmSettings";
import WelcomeScreen from "./components/WelcomeScreen";
import BatchDialogHost from "./components/BatchDialogHost";
import { useEvidence } from "./context/useEvidence";
import { useLlmConfig } from "./context/useLlmConfig";
import { useWorkspace } from "./context/useWorkspace";
import { AnalysisProvider } from "./context/AnalysisContext";
import { BatchProvider } from "./context/BatchContext";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import "./App.css";

function AppContent() {
  const { selectedCommit, openCommit, closeCommit, viewer, closeViewer, setHighlighted } =
    useEvidence();
  const { active, backendStatus, showHome } = useWorkspace();
  const activeUrl = active?.url;

  // El commit seleccionado, el archivo abierto y el resaltado pertenecen al grupo anterior:
  // se cierran al cambiar de grupo.
  useEffect(() => {
    closeCommit();
    closeViewer();
    setHighlighted(null);
  }, [activeUrl, closeCommit, closeViewer, setHighlighted]);

  if (backendStatus !== "ready") return <BackendStatusScreen />;
  if (!active) return <WelcomeScreen />;

  // Con el inicio abierto el grupo sigue montado (solo oculto): así vuelve tal como estaba, con sus
  // filtros, su día elegido y hasta un análisis en curso, que no se cancela.
  return (
    <>
      {showHome && <WelcomeScreen />}
      <div className="app" hidden={showHome}>
        {!showHome && <TourLauncher />}
        <TopBar />
        <BackendNotices />
        {/* Una sola key por grupo: al cambiar de grupo se desmonta todo lo que depende de él. */}
        <Fragment key={active.url}>
          <AnalysisProvider>
            <GroupWorkspace onCommitClick={openCommit} />
          </AnalysisProvider>
        </Fragment>

        {selectedCommit && <CommitDetailPanel commitHash={selectedCommit} key={selectedCommit} onClose={closeCommit} />}
        {viewer && <ArtifactViewer view={viewer} />}
      </div>
    </>
  );
}

/** El modal vive aquí para poder abrirse desde cualquier pantalla. */
function LlmSettingsHost() {
  const { settingsOpen } = useLlmConfig();
  return settingsOpen ? <LlmSettings /> : null;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <BatchProvider>
        <AppContent />
        <BatchDialogHost />
        <LlmSettingsHost />
      </BatchProvider>
    </WorkspaceProvider>
  );
}
