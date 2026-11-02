/** Estado de cada grupo en el análisis por lote. */
export type BatchState =
  | { status: "pending" }
  | { status: "running" }
  | { status: "done" }
  | { status: "error"; message: string };

export interface BatchRunResult {
  done: number;
  failed: number;
  /** Se canceló antes de terminar: los grupos que quedaron sin analizar siguen pendientes. */
  cancelled: boolean;
}

export interface BatchHooks {
  onStatus: (index: number, state: BatchState) => void;
  signal: AbortSignal;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Analiza los elementos de uno en uno. Si uno falla lo anota y sigue con el siguiente; cancelar
 * (señal) aborta el que está en curso, que vuelve a pendiente, y no lanza los demás.
 */
export async function runBatch<T>(
  items: T[],
  analyze: (item: T, signal: AbortSignal) => Promise<void>,
  { onStatus, signal }: BatchHooks,
): Promise<BatchRunResult> {
  const result: BatchRunResult = { done: 0, failed: 0, cancelled: false };
  for (let i = 0; i < items.length; i += 1) {
    if (signal.aborted) break;
    onStatus(i, { status: "running" });
    try {
      await analyze(items[i], signal);
      onStatus(i, { status: "done" });
      result.done += 1;
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        onStatus(i, { status: "pending" });
        break;
      }
      onStatus(i, {
        status: "error",
        message: err instanceof Error ? err.message : "No se pudo analizar este grupo.",
      });
      result.failed += 1;
    }
  }
  result.cancelled = signal.aborted;
  return result;
}
