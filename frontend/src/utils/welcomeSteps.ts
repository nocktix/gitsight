export type StepTone = "current" | "done" | "upcoming" | "warning" | "success";
export type StepIcon = "check" | "warning" | null;

export interface WelcomeStep {
  n: 1 | 2 | 3;
  text: string;
  tone: StepTone;
  /** El estado nunca depende solo del color: además del texto, el ícono cambia (✓ en el círculo, ⚠ junto al texto). */
  icon: StepIcon;
  /** Solo el paso del modelo es un botón. */
  action: boolean;
}

/**
 * Los tres pasos del inicio. El 1 queda completado (✓) cuando ya hay un lote escaneado y el 3 pasa
 * a ser el actual; el 2 muestra el estado del modelo (sin la clave: `modelStatus` solo da la etiqueta).
 */
export function welcomeSteps(model: { configured: boolean; label: string }, scanned: boolean): WelcomeStep[] {
  return [
    {
      n: 1,
      text: "Elige qué revisar",
      tone: scanned ? "done" : "current",
      icon: scanned ? "check" : null,
      action: false,
    },
    model.configured
      ? { n: 2, text: model.label, tone: "success", icon: "check", action: true }
      : { n: 2, text: "Configura el modelo de IA", tone: "warning", icon: "warning", action: true },
    { n: 3, text: "Analizar", tone: scanned ? "current" : "upcoming", icon: null, action: false },
  ];
}
