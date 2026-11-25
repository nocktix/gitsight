/** Accesos rápidos de la pantalla de inicio: grupos abiertos hace poco y la demo. */

export interface RecentGroup {
  taskId: string;
  groupUrl: string;
  name: string;
}

export const MAX_RECENT = 3;
export const DEMO_REPO_URL = "https://github.com/nocktix/tarea-demo-equipo1";

/** Pone `entry` primero (sin repetirlo) y deja como máximo `max` grupos. */
export function addRecent(list: RecentGroup[], entry: RecentGroup, max = MAX_RECENT): RecentGroup[] {
  return [entry, ...list.filter((g) => g.groupUrl !== entry.groupUrl)].slice(0, max);
}

/**
 * Recientes primero; si faltan, se completan con los grupos guardados (de la tarea más reciente
 * hacia atrás, sin repetir), hasta `max`.
 */
export function mergeRecents(recent: RecentGroup[], saved: RecentGroup[], max = MAX_RECENT): RecentGroup[] {
  const out: RecentGroup[] = [];
  for (const g of [...recent, ...saved]) {
    if (out.length >= max) break;
    if (!out.some((o) => o.groupUrl === g.groupUrl)) out.push(g);
  }
  return out;
}

/** Texto del chip: la tarea sin el dueño y el grupo. El título completo va en `title`. */
export function recentLabel(g: RecentGroup): string {
  return `${g.taskId.split("/").pop() ?? g.taskId} · ${g.name}`;
}
