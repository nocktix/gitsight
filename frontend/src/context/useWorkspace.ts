import { createContext, useContext } from "react";
import type { ImportCounts } from "../api/dbClient";
import type { CommitsData } from "../types/commits";
import type { RecentGroup } from "../utils/recentGroups";
import type { ParsedRepo } from "../utils/repoUrl";
import type { StoredGroup, TaskData } from "../utils/storage";

export type CommitsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: CommitsData; loadedAt: Date };

export interface WorkspaceValue {
  /** Grupo abierto; null = pantalla de bienvenida. */
  active: ParsedRepo | null;
  commits: CommitsState;

  /**
   * Mostrar la pantalla de inicio aunque haya un grupo abierto. No borra nada (ni el último grupo,
   * ni las tareas, ni los análisis, ni un lote en curso); se apaga al abrir cualquier grupo.
   */
  showHome: boolean;
  goHome: () => void;
  /** Sale de la pantalla de inicio y vuelve al grupo abierto, tal como estaba. */
  leaveHome: () => void;
  /** Grupos de todas las tareas guardadas, de la tarea más reciente hacia atrás (respaldo de los accesos rápidos). */
  savedGroups: RecentGroup[];

  taskIds: string[];
  groups: StoredGroup[];
  task: TaskData;

  /** URL que se está descargando (clonando) ahora mismo. */
  pendingUrl: string | null;
  openError: string | null;
  /** `taskId` fuerza la tarea (corrección manual del evaluador); si no, se detecta a partir de las tareas conocidas. */
  openGroup: (url: string, taskId?: string) => Promise<boolean>;
  /** Tarea y grupo detectados para una URL sin cargarla (null si la URL no es válida). */
  detectTask: (url: string) => ParsedRepo | null;
  switchTask: (taskId: string) => void;
  /** Lee la tarea del backend y la deja disponible (grupos, fechas, rúbrica); la devuelve. */
  refreshTask: (taskId: string) => Promise<TaskData>;

  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  /** Fechas efectivas de la tarea (null si faltan o el rango es inválido). */
  taskStart: Date | null;
  taskEnd: Date | null;
  datesError: string | null;

  /**
   * Sube la rúbrica como versión nueva de la tarea (activa por defecto). Devuelve su número y si
   * se creó (false: el texto era igual a una versión existente y se reutilizó), o null si no se
   * pudo guardar.
   */
  saveRubric: (
    text: string,
    meta?: { filename?: string | null; note?: string | null; activate?: boolean },
    /** Tarea de destino; por defecto la del grupo abierto. El lote pasa la de la carpeta escaneada. */
    taskId?: string,
  ) => Promise<{ version: number; created: boolean } | null>;
  /** Activa una versión: los próximos análisis de todos los grupos de la tarea la usan. */
  activateRubric: (version: number) => Promise<boolean>;
  /** Cambia cada vez que se sube o activa una versión; sirve para recargar la lista. */
  rubricRevision: number;

  /** Estado de la conexión con el backend al iniciar (migración y lectura de datos). */
  backendStatus: "loading" | "ready" | "error";
  backendError: string | null;
  retryBackend: () => void;
  /** Resultado de la importación única desde localStorage (null = no hubo nada que mostrar). */
  migration: ImportCounts | null;
  dismissMigration: () => void;
  /** Un cambio no se pudo guardar en el backend. */
  writeError: string | null;
  dismissWriteError: () => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace debe usarse dentro de WorkspaceProvider");
  return ctx;
}
