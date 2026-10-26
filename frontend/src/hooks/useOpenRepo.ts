import { useState } from "react";
import { useWorkspace } from "../context/useWorkspace";
import type { ParsedRepo } from "../utils/repoUrl";

/**
 * Abrir un repo pegando su URL. Si la tarea detectada es nueva (no calza con ninguna del
 * historial), primero se pide confirmar o corregir su identificador y recién ahí se descarga.
 */
export function useOpenRepo(onOpened: () => void) {
  const { openGroup, detectTask } = useWorkspace();
  const [toConfirm, setToConfirm] = useState<ParsedRepo | null>(null);

  async function open(url: string, taskId?: string) {
    if (await openGroup(url, taskId)) onOpened();
  }

  return {
    toConfirm,
    submit(url: string) {
      const detected = detectTask(url);
      if (detected && !detected.taskIsKnown) {
        setToConfirm(detected);
        return;
      }
      void open(url);
    },
    confirm(taskId: string) {
      if (!toConfirm) return;
      const url = toConfirm.url;
      setToConfirm(null);
      void open(url, taskId);
    },
    cancel() {
      setToConfirm(null);
    },
  };
}
