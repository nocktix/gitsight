/** Estado de cada grupo en el análisis por lote. */
export type BatchState =
  | { status: "pending" }
  | { status: "running" }
  /** El proveedor pidió esperar (límite por minuto): se reintenta tras una pausa. */
  | { status: "waiting" }
  | { status: "done" }
  | { status: "error"; message: string };

/** Qué hacer ante el error de un grupo. */
export type BatchErrorKind = "error" | "rate_limited" | "stop";

export interface BatchRunResult {
  done: number;
  failed: number;
  /** Se canceló antes de terminar: los grupos que quedaron sin analizar siguen pendientes. */
  cancelled: boolean;
  /** El lote se detuvo por un error que reintentar no arregla (el que lo causó, tal cual). */
  stopped: { index: number; error: unknown } | null;
}

export interface BatchHooks {
  onStatus: (index: number, state: BatchState) => void;
  signal: AbortSignal;
  /** Cuántos elementos a la vez (por defecto 1). */
  concurrency?: number;
  /** Clasifica un error; por defecto todos son `error` (se anota y se sigue). */
  classify?: (err: unknown) => BatchErrorKind;
  /** Pausa antes de reintentar un `rate_limited` (ms). */
  rateLimitWaitMs?: number;
  /** Reintentos por `rate_limited` antes de dar el caso por perdido y detener el lote. */
  maxRateLimitRetries?: number;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** Espera `ms`; devuelve false si la señal se aborta antes. */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Analiza los elementos con un pool de `concurrency` trabajadores, en orden. Un error de un
 * elemento lo marca y sigue con el siguiente. `rate_limited` pausa a ese elemento y lo reintenta
 * (hasta `maxRateLimitRetries` veces; si sigue fallando se trata como `stop`). `stop` detiene el
 * lote: no se lanzan elementos nuevos, los que estaban en curso terminan, y el que lo causó y los
 * que faltan quedan pendientes. Cancelar (señal) aborta los que están en curso, que vuelven a
 * pendiente, y no lanza los demás.
 */
export async function runBatch<T>(
  items: T[],
  analyze: (item: T, signal: AbortSignal) => Promise<void>,
  {
    onStatus,
    signal,
    concurrency = 1,
    classify = () => "error",
    rateLimitWaitMs = 30_000,
    maxRateLimitRetries = 2,
  }: BatchHooks,
): Promise<BatchRunResult> {
  const result: BatchRunResult = { done: 0, failed: 0, cancelled: false, stopped: null };
  let next = 0;

  async function runOne(i: number): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      onStatus(i, { status: "running" });
      try {
        await analyze(items[i], signal);
        onStatus(i, { status: "done" });
        result.done += 1;
        return;
      } catch (err) {
        if (isAbort(err) || signal.aborted) {
          onStatus(i, { status: "pending" });
          return;
        }
        const kind = classify(err);
        if (kind === "rate_limited" && attempt < maxRateLimitRetries) {
          onStatus(i, { status: "waiting" });
          if (await wait(rateLimitWaitMs, signal)) continue;
          onStatus(i, { status: "pending" });
          return;
        }
        if (kind === "rate_limited" || kind === "stop") {
          result.stopped ??= { index: i, error: err };
          onStatus(i, { status: "pending" });
          return;
        }
        onStatus(i, {
          status: "error",
          message: err instanceof Error ? err.message : "No se pudo analizar este grupo.",
        });
        result.failed += 1;
        return;
      }
    }
  }

  async function worker(): Promise<void> {
    while (!signal.aborted && !result.stopped && next < items.length) {
      const i = next;
      next += 1;
      await runOne(i);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  result.cancelled = signal.aborted;
  return result;
}
