/**
 * Fechas de la tarea: cuándo se guarda lo que se escribe y cómo se mantiene una sola fuente de
 * verdad (el backend) aunque los guardados fallen o terminen en otro orden.
 */

export interface TaskDates {
  startDate: string;
  endDate: string;
}

export type DateKey = keyof TaskDates;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/**
 * Una fecha completa y razonable («YYYY-MM-DD», año de 4 dígitos entre 1900 y 2100). Mientras se
 * escribe el año, un campo de fecha entrega valores intermedios válidos («0002-11-24»,
 * «0020-11-24»…): no son fechas de una tarea y no se guardan.
 */
export function isCommittableDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type DateCommit = "save" | "revert" | "wait";

/**
 * Qué hacer con lo que hay escrito en el campo (`draft`) frente a lo ya guardado (`saved`).
 * - Al cambiar: se guarda solo una fecha completa distinta de la guardada; lo demás espera.
 * - Al salir del campo: un campo vacío guarda el borrado; una fecha a medias se descarta (el campo
 *   vuelve a lo guardado).
 */
export function decideDateCommit(draft: string, saved: string, event: "change" | "blur"): DateCommit {
  if (isCommittableDate(draft)) return draft === saved ? "wait" : "save";
  if (event === "change") return "wait";
  if (draft === "") return saved === "" ? "wait" : "save";
  return "revert";
}

export interface DateStoreDeps {
  get: () => TaskDates;
  set: (dates: TaskDates) => void;
  /** El backend reemplaza ambas fechas, así que siempre se mandan las dos. */
  save: (dates: TaskDates) => Promise<void>;
  /** Lee las fechas guardadas en el backend. */
  reload: () => Promise<TaskDates>;
  onError: (err: unknown) => void;
}

/**
 * Cambios de fecha de una tarea. La pantalla se actualiza al instante, pero:
 * - los guardados salen de a uno y en el orden en que se hicieron, para que el backend termine
 *   con la última fecha elegida;
 * - un guardado fallido solo corrige la pantalla si ningún cambio posterior lo reemplazó (una
 *   respuesta vieja no pisa un estado más nuevo);
 * - tras un fallo se vuelve a leer del backend, que es la fuente de verdad; si tampoco se puede
 *   leer, se restaura la fecha anterior.
 */
export function createDateStore(deps: DateStoreDeps) {
  let version = 0;
  let queue: Promise<void> = Promise.resolve();

  return {
    change(key: DateKey, value: string): void {
      const before = deps.get();
      const previous = before[key];
      const next = { ...before, [key]: value };
      deps.set(next);
      const mine = ++version;
      queue = queue
        .then(() => deps.save(next))
        .catch(async (err: unknown) => {
          if (mine !== version) return; // ya hay un cambio más nuevo: esta respuesta no cuenta
          deps.onError(err);
          let real: TaskDates | null = null;
          try {
            real = await deps.reload();
          } catch {
            real = null;
          }
          if (mine !== version) return;
          deps.set(real ?? { ...deps.get(), [key]: previous });
        });
    },
    /** Espera a que terminen los guardados pendientes (para pruebas). */
    settled: () => queue,
  };
}
