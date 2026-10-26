import { useState } from "react";
import type { ReactNode } from "react";
import { activeConfig, readLlmStore, writeLlmStore } from "../utils/llmConfig";
import type { LlmStore } from "../utils/llmConfig";
import { LlmConfigContext } from "./useLlmConfig";


/** Un único proveedor de IA para toda la app: lo usan el análisis y el resumen por commit. */
export function LlmConfigProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState(readLlmStore);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function save(next: LlmStore) {
    writeLlmStore(next);
    setStore(next);
  }

  return (
    <LlmConfigContext.Provider
      value={{
        store,
        config: activeConfig(store),
        save,
        settingsOpen,
        openSettings: () => setSettingsOpen(true),
        closeSettings: () => setSettingsOpen(false),
      }}
    >
      {children}
    </LlmConfigContext.Provider>
  );
}
