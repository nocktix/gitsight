import { Fragment, useEffect } from "react";
import { BackendNotices, BackendStatusScreen } from "./components/BackendNotices";
import ActivityCalendars from "./components/ActivityCalendars";
import ArtifactViewer from "./components/ArtifactViewer";
import CommitDetailPanel from "./components/CommitDetailPanel";
import { TourLauncher } from "./components/Tour";
import RepoHeader from "./components/RepoHeader";
import RepoUrlField from "./components/RepoUrlField";
import TaskDateFields from "./components/TaskDateFields";
import TopBar from "./components/TopBar";
import TriangulationPanel from "./components/TriangulationPanel";
import LlmSettings from "./components/LlmSettings";
import WelcomeScreen from "./components/WelcomeScreen";
import { useEvidence } from "./context/useEvidence";
import { useLlmConfig } from "./context/useLlmConfig";
import { useWorkspace } from "./context/useWorkspace";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import "./App.css";

function AppContent() {
  const { selectedCommit, openCommit, closeCommit, viewer, closeViewer, setHighlighted } =
    useEvidence();
  const { active, backendStatus } = useWorkspace();
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

  return (
    <div className="app">
      <TourLauncher />
      <TopBar />
      <BackendNotices />
      <RepoUrlField />
      <TaskDateFields />
      <RepoHeader />
      {/* Una sola key por grupo: al cambiar de grupo se desmonta todo lo que depende de él. */}
      <Fragment key={active.url}>
        <TriangulationPanel />
        <ActivityCalendars onCommitClick={openCommit} />
      </Fragment>

      {selectedCommit && <CommitDetailPanel commitHash={selectedCommit} key={selectedCommit} onClose={closeCommit} />}
      {viewer && <ArtifactViewer view={viewer} />}
    </div>
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
      <AppContent />
      <LlmSettingsHost />
    </WorkspaceProvider>
  );
}
