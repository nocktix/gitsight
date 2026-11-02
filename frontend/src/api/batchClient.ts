import { backendFetch, errorFromResponse } from "./http.ts";

/** Un repo de la carpeta descargada, ya registrado como grupo de la tarea. */
export interface BatchGroup {
  name: string;
  /** Clave del grupo: la URL del origin; sin origin, la ruta local. */
  url: string;
  /** Carpeta local del repo (cambia en cada descarga). */
  path: string;
  hasOrigin: boolean;
  /** null si no se pudieron contar (repo dañado o vacío). */
  commits: number | null;
}

export interface BatchScan {
  taskId: string;
  warnings: string[];
  groups: BatchGroup[];
}

interface ScanBody {
  task_id: string;
  warnings: string[];
  groups: { name: string; url: string; path: string; has_origin: boolean; commits: number | null }[];
}

/** Lista los repos de la carpeta y los registra como grupos de la tarea deducida. */
export async function scanFolder(folder: string): Promise<BatchScan> {
  const res = await backendFetch("/api/batch/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const body = (await res.json()) as ScanBody;
  return {
    taskId: body.task_id,
    warnings: body.warnings,
    groups: body.groups.map((g) => ({
      name: g.name,
      url: g.url,
      path: g.path,
      hasOrigin: g.has_origin,
      commits: g.commits,
    })),
  };
}
