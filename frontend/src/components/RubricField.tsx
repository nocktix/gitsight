import { useRef, useState } from "react";
import { extractRubric } from "../api/rubricClient";
import "./RubricField.css";

export interface RubricSubmit {
  text: string;
  /** Archivo del que se extrajo el texto; null si se pegó. */
  filename: string | null;
  note: string | null;
}

/**
 * Editor de la rúbrica: subir un archivo (el backend solo extrae el texto) o pegarlo.
 * El texto queda en un textarea editable para revisar y corregir la extracción. Guardar crea
 * una versión nueva de la rúbrica de la tarea, con el nombre del archivo y una nota opcional.
 */
export default function RubricField({
  initialText,
  onSubmit,
  onSaveOnly,
  onCancel,
  submitLabel,
}: {
  initialText: string;
  /** Guardar y analizar. */
  onSubmit: (value: RubricSubmit) => void;
  /** Guardar como versión nueva sin analizar. */
  onSaveOnly: (value: RubricSubmit) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [text, setText] = useState(initialText);
  const [filename, setFilename] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setExtracting(true);
    setError(null);
    try {
      setText(await extractRubric(file));
      setFilename(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setExtracting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const value = (): RubricSubmit => ({
    text: text.trim(),
    filename,
    note: note.trim() || null,
  });
  const blocked = !text.trim() || extracting;

  return (
    <div className="rubric-field">
      <div className="rubric-field__upload">
        <label className="rubric-field__file">
          Subir archivo (.pdf, .docx, .md, .txt)
          <input
            accept=".pdf,.docx,.md,.txt"
            disabled={extracting}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            ref={fileInput}
            type="file"
          />
        </label>
        <span className="rubric-field__or">o pega el texto de la rúbrica abajo</span>
      </div>
      {filename && <p className="rubric-field__status">Archivo: {filename}</p>}
      {extracting && <p className="rubric-field__status">Extrayendo texto…</p>}
      {error && <p className="rubric-field__error">{error}</p>}
      <textarea
        aria-label="Texto de la rúbrica"
        className="rubric-field__textarea"
        onChange={(event) => setText(event.target.value)}
        placeholder="Texto de la rúbrica. Revisa que la extracción esté completa y corrígela si hace falta."
        rows={12}
        value={text}
      />
      <label className="rubric-field__file">
        Nota de esta versión (opcional)
        <input
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ej.: se agregó el criterio de uso de IA"
          type="text"
          value={note}
        />
      </label>
      <p className="rubric-field__status">
        Se guarda como una versión nueva de la rúbrica de la tarea y pasa a ser la activa; las
        anteriores se conservan. Si el texto es igual al de una versión existente, se reutiliza esa.
      </p>
      <div className="rubric-field__actions">
        <button
          className="rubric-field__primary"
          disabled={blocked}
          onClick={() => onSubmit(value())}
          type="button"
        >
          {submitLabel}
        </button>
        <button
          className="rubric-field__secondary"
          disabled={blocked}
          onClick={() => onSaveOnly(value())}
          type="button"
        >
          Solo guardar como versión nueva
        </button>
        <button className="rubric-field__secondary" onClick={onCancel} type="button">
          Cancelar
        </button>
      </div>
    </div>
  );
}
