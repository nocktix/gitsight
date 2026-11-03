/** Idioma en que responde la IA, elegido por el evaluador y recordado en localStorage. */

export interface LanguageOption {
  code: string;
  label: string;
}

/** Los mismos códigos que acepta el backend (backend/app/languages.py). */
export const LANGUAGES: LanguageOption[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

export const DEFAULT_LANGUAGE = "es";

const KEY = "tid.language";

function isLanguage(value: unknown): value is string {
  return LANGUAGES.some((l) => l.code === value);
}

/** Lo guardado, o "es" si no hay nada, está dañado o localStorage no está disponible. */
export function readLanguage(): string {
  try {
    const raw = localStorage.getItem(KEY);
    return isLanguage(raw) ? raw : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function writeLanguage(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // sin localStorage el idioma solo dura la sesión
  }
}

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}
