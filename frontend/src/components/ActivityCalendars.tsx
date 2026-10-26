import { useMemo, useState } from "react";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { useEvidence } from "../context/useEvidence";
import { useWorkspace } from "../context/useWorkspace";
import {
  buildActivity,
  calendarRange,
  dayKeyOfLocalDate,
  formatCommits,
  formatLines,
  formatMembers,
  groupStatsByDay,
  statsByDay,
  summarize,
} from "../utils/commitTime";
import { allCommitsOutsideWindow } from "../utils/emptyStates";
import CalendarHeader from "./CalendarHeader";
import EmptyState from "./EmptyState";
import ContributorCalendar from "./ContributorCalendar";
import DayHoursView from "./DayHoursView";
import SummaryCards from "./SummaryCards";
import "./ActivityCalendars.css";

const INFO_WIDTH = 120;
const ROW_GAP = 12;
const CELL_GAP = 2;
const MIN_CELL = 18;
const MAX_CELL = 44;

/** Tamaño de cuadrado para que `dayCount` columnas quepan en `available` px, entre 18 y 44. */
function cellSizeFor(dayCount: number, available: number): number {
  const fit = Math.floor((available - (dayCount - 1) * CELL_GAP) / dayCount);
  return Math.min(MAX_CELL, Math.max(MIN_CELL, fit));
}

/** Lleva el cursor al campo marcado con data-tour (fechas de la tarea, abrir repositorio). */
function focusField(name: string) {
  const root = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  root?.scrollIntoView({ block: "center" });
  root?.querySelector<HTMLInputElement>("input")?.focus();
}

export default function ActivityCalendars({
  onCommitClick,
}: {
  onCommitClick: (hash: string) => void;
}) {
  const { commits: state, taskStart, taskEnd } = useWorkspace();
  const [selected, setSelected] = useState<{ day: string; author: string | null } | null>(null);
  const [rowsRef, rowsWidth] = useContainerWidth(900);

  const data = state.status === "success" ? state.data : null;
  const activity = useMemo(() => (data ? buildActivity(data) : null), [data]);

  // Un chip de evidencia pide ver el día del commit: el calendario salta a su vista por horas.
  const { focusRequest } = useEvidence();
  const [seenNonce, setSeenNonce] = useState(focusRequest?.nonce ?? 0);
  if (focusRequest && focusRequest.nonce !== seenNonce && activity) {
    setSeenNonce(focusRequest.nonce);
    for (const { author, commits } of activity.contributors) {
      const found = commits.find((c) => c.hash === focusRequest.hash);
      if (found) {
        setSelected({ day: found.dayKey, author });
        break;
      }
    }
  }

  const startKey = taskStart ? dayKeyOfLocalDate(taskStart) : null;
  const endKey = taskEnd ? dayKeyOfLocalDate(taskEnd) : null;

  const body = (() => {
    if (!activity) return null;
    const { contributors, mergeOnly } = activity;
    const allCommits = contributors.flatMap((c) => c.commits);
    const range = calendarRange(
      allCommits.map((c) => c.dayKey),
      startKey,
      endKey,
    );
    const mergeOnlyNote = mergeOnly.length > 0 && (
      <p className="activity__note">Solo merges: {mergeOnly.join(", ")}</p>
    );

    if (!range || contributors.length === 0) {
      return (
        <>
          <EmptyState
            text="Este repositorio no tiene commits de trabajo (los merges no se cuentan). Si es el repositorio equivocado, puedes abrir otro."
            title="No hay commits para mostrar"
          >
            <button onClick={() => focusField("repo")} type="button">
              Abrir otro repositorio
            </button>
          </EmptyState>
          {mergeOnlyNote}
        </>
      );
    }

    const outsideWindow = allCommitsOutsideWindow(
      allCommits.map((c) => c.dayKey),
      startKey,
      endKey,
    );

    const maxLines = allCommits.reduce((max, c) => Math.max(max, c.totalLines), 0);

    if (selected && allCommits.some((c) => c.dayKey === selected.day)) {
      return (
        <DayHoursView
          contributors={contributors}
          dayKey={selected.day}
          deadlineDayKey={endKey}
          maxLines={maxLines}
          onBack={() => setSelected(null)}
          onCommitClick={onCommitClick}
          selectedAuthor={selected.author}
        />
      );
    }

    // Escala compartida: el máximo se calcula sobre todos los contribuidores.
    const maxCount = Math.max(
      ...contributors.flatMap((c) => [...statsByDay(c.commits).values()].map((d) => d.commits)),
    );
    // El grupo tiene su propia escala: se normaliza a su día de mayor actividad.
    const groupMaxCount = Math.max(
      ...[...groupStatsByDay(contributors).values()].map((d) => d.commits),
    );
    const groupLines = allCommits.reduce((sum, c) => sum + c.totalLines, 0);
    const cell = cellSizeFor(range.days.length, rowsWidth - INFO_WIDTH - ROW_GAP);
    return (
      <>
        {outsideWindow && (
          <EmptyState
            text="Todos los commits de este grupo están fuera de las fechas de la tarea. Revisa que el inicio y la entrega sean los correctos."
            title="No hay commits entre el inicio y la entrega"
          >
            <button onClick={() => focusField("dates")} type="button">
              Cambiar fechas
            </button>
          </EmptyState>
        )}
        <SummaryCards summary={summarize(allCommits, endKey)} />

        <div
          className="activity__rows"
          style={{ "--cell": `${cell}px`, "--gap": `${CELL_GAP}px` } as React.CSSProperties}
        >
          <div className="activity__header">
            <CalendarHeader days={range.days} />
          </div>
          <ContributorCalendar
            author="Grupo"
            commits={allCommits}
            days={range.days}
            endKey={endKey}
            group
            maxCount={groupMaxCount}
            onSelectDay={(day) => setSelected({ day, author: null })}
            startKey={startKey}
            stats={`${formatCommits(allCommits.length)} · ${formatLines(groupLines)}\n${formatMembers(contributors.length)}`}
          />
          {contributors.map((c) => (
            <ContributorCalendar
              author={c.author}
              commits={c.commits}
              days={range.days}
              endKey={endKey}
              key={c.author}
              maxCount={maxCount}
              onSelectDay={(day) => setSelected({ day, author: c.author })}
              startKey={startKey}
            />
          ))}
        </div>

        <div className="activity__legend">
          <span className="activity__legend-item">
            <i className="activity__swatch activity__swatch--start" /> Inicio
          </span>
          <span className="activity__legend-item">
            <i className="activity__swatch activity__swatch--end" /> Entrega
          </span>
          <span className="activity__legend-item">
            <i className="activity__swatch activity__swatch--late" /> Después de la entrega
          </span>
          <span className="activity__legend-item">
            <i className="activity__swatch activity__swatch--late-commit" /> Commits fuera de plazo
          </span>
          <span className="activity__legend-item">
            Menos
            {[0, 1, 2, 3, 4].map((level) => (
              <i className={`activity__swatch activity__swatch--l${level}`} key={level} />
            ))}
            Más
          </span>
        </div>

        {mergeOnlyNote}
      </>
    );
  })();

  return (
    <section className="activity" data-tour="calendar">
      <h2 className="activity__title">Actividad diaria de contribuidores</h2>

      {state.status === "loading" && <p className="activity__loading">Cargando commits...</p>}

      {state.status === "error" && (
        <div className="activity__error">
          <p>No se pudieron cargar los commits del repo.</p>
          <p className="activity__error-detail">{state.message}</p>
        </div>
      )}

      {/* El ancho se mide en un contenedor que siempre existe, para calcular el tamaño de los cuadrados. */}
      <div ref={rowsRef}>
        {/* La key reinicia la animación al pasar del calendario a la vista por horas y de vuelta. */}
        <div className="activity__view" key={selected ? "day" : "calendar"}>
          {body}
        </div>
      </div>
    </section>
  );
}
