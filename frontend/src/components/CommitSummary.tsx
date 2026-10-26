import { useEffect, useState } from "react";
import { generateSummary, getSavedSummary } from "../api/commitSummaryClient";
import { BackendError } from "../api/http";
import { useLlmConfig } from "../context/useLlmConfig";
import type { CommitSummary as Summary } from "../types/commitSummary";
import { formatSantiago } from "../utils/analysisHistory";
import { coverageNote, messageCheckLabel, statsLine } from "../utils/summaryView";
import { llmRequest } from "../utils/llmConfig";
import LlmErrorRetry from "./LlmErrorRetry";
import LlmNotConfigured from "./LlmNotConfigured";
import "./CommitSummary.css";

/**
 * Resumen del commit con IA. Al abrir el commit solo consulta lo guardado (el backend no llama
 * al LLM); generar o regenerar es una acción del evaluador. Un error se muestra aquí sin
 * afectar al diff, y conserva el resumen anterior si lo hay. El padre lo monta con `key` = hash:
 * cada commit parte con el estado limpio.
 */
export default function CommitSummary({
  commitHash,
  repoUrl,
}: {
  commitHash: string;
  repoUrl: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { config } = useLlmConfig();

  useEffect(() => {
    const controller = new AbortController();
    getSavedSummary(repoUrl, commitHash, controller.signal)
      .then((saved) => {
        setSummary(saved);
        setChecking(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err);
        setChecking(false);
      });
    return () => controller.abort();
  }, [commitHash, repoUrl]);

  function run(regenerate: boolean) {
    if (!config) return;
    const { llm, apiKey } = llmRequest(config);
    setBusy(true);
    setError(null);
    generateSummary(repoUrl, commitHash, regenerate, llm, apiKey)
      .then(setSummary)
      .catch((err: Error) => setError(err))
      .finally(() => setBusy(false));
  }

  const note = summary ? coverageNote(summary.coverage) : null;

  return (
    <section className="commit-summary">
      <div className="commit-summary__header">
        <h3 className="commit-summary__title">Resumen con IA</h3>
        {summary && (
          <button disabled={busy || !config} onClick={() => run(true)} type="button">
            {busy ? "Regenerando..." : "Regenerar"}
          </button>
        )}
      </div>

      {checking && <p className="commit-summary__status">Buscando resumen guardado...</p>}

      {!checking && !summary && !config && <LlmNotConfigured className="commit-summary__status" />}

      {!checking && !summary && config && (
        <button
          className="commit-summary__primary"
          disabled={busy}
          onClick={() => run(false)}
          type="button"
        >
          {busy ? "Resumiendo..." : "Resumir con IA"}
        </button>
      )}

      {error &&
        (error instanceof BackendError && error.isLlmError ? (
          <LlmErrorRetry
            className="commit-summary__error"
            code={error.code}
            failedModel={error.modelAttempted}
            message={error.message}
            onRetry={() => run(summary !== null)}
          />
        ) : (
          <p className="commit-summary__error" role="alert">
            {error.message}
          </p>
        ))}

      {summary && (
        <>
          <p className="commit-summary__meta">
            {summary.model} · {formatSantiago(summary.created_at)} (hora de Chile) ·{" "}
            {statsLine(summary.stats)}
          </p>
          {note && <p className="commit-summary__note">{note}</p>}
          <p className="commit-summary__text">{summary.summary}</p>
          {summary.main_files.length > 0 && (
            <ul className="commit-summary__files">
              {summary.main_files.map((file) => (
                <li key={file.filename}>
                  <code>{file.filename}</code>: {file.change}
                </li>
              ))}
            </ul>
          )}
          <p className="commit-summary__check">
            <strong>{messageCheckLabel(summary.message_check.status)}.</strong>{" "}
            {summary.message_check.observation}
          </p>
        </>
      )}
    </section>
  );
}
