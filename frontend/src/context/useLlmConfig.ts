import { createContext, useContext } from "react";
import type { LlmConfig, LlmStore } from "../utils/llmConfig";

export interface LlmConfigValue {
  store: LlmStore;
  /** Configuración completa en uso; null si falta elegir proveedor, modelo o key. */
  config: LlmConfig | null;
  save: (next: LlmStore) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const LlmConfigContext = createContext<LlmConfigValue | null>(null);

export function useLlmConfig(): LlmConfigValue {
  const value = useContext(LlmConfigContext);
  if (!value) throw new Error("useLlmConfig debe usarse dentro de LlmConfigProvider");
  return value;
}
