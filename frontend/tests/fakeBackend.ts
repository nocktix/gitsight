/** Utilidades de test: localStorage y fetch falsos. */

export function fakeLocalStorage(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
}

export interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (call: Call) => { status?: number; body: unknown };

/** Reemplaza `fetch`; cada llamada queda registrada en `calls`. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const call = {
      url: url.replace("http://localhost:8000", ""),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(JSON.stringify(body), { status });
  };
  return calls;
}

export function unreachableFetch() {
  (globalThis as { fetch?: unknown }).fetch = async () => {
    throw new TypeError("fetch failed");
  };
}
