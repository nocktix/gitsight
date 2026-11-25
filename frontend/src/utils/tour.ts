/** Recorrido guiado de la primera vez. Que ya se vio se recuerda en localStorage. */

const KEY = "tid.tour.seen";

export interface TourStep {
  title: string;
  text: string;
  /** Elemento que se resalta (atributo data-tour). */
  selector: string;
  /** Si el primero no existe en pantalla (p. ej. todavía no hay análisis), se resalta este. */
  fallback?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Barra superior",
    text: "Te damos la bienvenida a GitSight. Desde la barra superior cambias de tarea o de grupo, eliges el idioma en que responde la IA y, con «Abrir grupo o tarea» (o el logo), vas al inicio para abrir otro grupo o una tarea completa; desde ahí «← Volver» te regresa al grupo. El botón ? vuelve a mostrar este recorrido.",
    selector: '[data-tour="topbar"]',
  },
  {
    title: "Modelo de IA",
    text: "Antes de analizar, elige tu proveedor de IA, el modelo y pega tu clave (API key). La clave se guarda solo en este navegador. Con “Probar conexión” compruebas que funciona.",
    selector: '[data-tour="model"]',
  },
  {
    title: "Encabezado del grupo",
    text: "Aquí ves el grupo, su tarea, sus integrantes, cuántos commits tiene y cómo va el análisis (sin analizar, analizado el… o desactualizado). El botón Analizar lanza el análisis con IA; después se convierte en Volver a analizar.",
    selector: '[data-tour="group-header"]',
  },
  {
    title: "Configuración de la tarea",
    text: "Despliega esta sección para indicar el inicio y la entrega de la tarea (el análisis las usa para señalar los commits posteriores a la entrega) y para ver o cambiar la rúbrica. La rúbrica tiene versiones: al subir una nueva se conservan las anteriores, y cada análisis recuerda con cuál se hizo.",
    selector: '[data-tour="config"]',
  },
  {
    title: "Calendario de actividad",
    text: "Cada cuadrado es un día: mientras más oscuro, más commits. Haz clic en un día para ver sus commits por hora, y en un triángulo para ver los cambios de ese commit. Se queda a la vista mientras recorres los hallazgos.",
    selector: '[data-tour="calendar"]',
  },
  {
    title: "Hallazgos",
    text: "Aquí se contrastan los commits, la bitácora de prompts y la declaración de autoría, organizados por criterio de la rúbrica. Filtra por tipo con los botones de arriba. Solo se muestran hechos y la evidencia que los respalda; la evaluación es tuya.",
    selector: '[data-tour="findings"]',
  },
  {
    title: "Evidencia de cada hallazgo",
    text: "Cada hallazgo trae chips con los commits y las líneas en que se apoya: haz clic para verlos. Al pasar el mouse sobre un hallazgo, sus commits se resaltan en el calendario. Aparecen después de ejecutar un análisis.",
    selector: '[data-tour="evidence"]',
    fallback: '[data-tour="findings"]',
  },
];

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // sin localStorage el recorrido solo se recuerda mientras la página siga abierta
  }
}

/** Posición de la tarjeta: debajo del elemento, encima si no cabe, o abajo de la pantalla. */
export function placeCard(
  target: { top: number; bottom: number; left: number; width: number } | null,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): { top: number; left: number } {
  const margin = 12;
  const clampLeft = (left: number) =>
    Math.max(margin, Math.min(left, viewport.width - card.width - margin));
  if (!target) {
    return {
      top: Math.max(margin, (viewport.height - card.height) / 2),
      left: clampLeft((viewport.width - card.width) / 2),
    };
  }
  const left = clampLeft(target.left + target.width / 2 - card.width / 2);
  if (viewport.height - target.bottom - margin >= card.height) return { top: target.bottom + margin, left };
  if (target.top - margin >= card.height) return { top: target.top - margin - card.height, left };
  return { top: viewport.height - card.height - margin, left };
}
