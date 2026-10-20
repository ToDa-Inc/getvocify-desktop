import { useState } from "react";
import { dayAfter, dayOf, monthGrid, type TaskDue } from "../../core/taskDates.ts";
import { FloatMenu, type Anchor } from "./FloatMenu.tsx";
import { ChevronDown, Close } from "./icons.tsx";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";

/**
 * The day and hour of a task, kept quiet: one calendar (today in the accent, the chosen day filled), the quick days as a
 * thin segmented control above it, and the hour as one small field below that is only there once an hour is wanted.
 * It floats over the island like the other pickers and never pushes the card down. Everything applies at once; a click
 * outside closes it.
 */

const QUICK = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "Next week", offset: 7 },
] as const;
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const DEFAULT_HOUR = "09:00";

const two = (n: number) => String(n).padStart(2, "0");

export function TaskDatePicker({ anchor, value, onChange, onClose, onExtent }: {
  anchor: Anchor;
  value: TaskDue;
  onChange: (value: TaskDue) => void;
  onClose: () => void;
  onExtent: (bottom: number | null) => void;
}) {
  const today = dayAfter(0);
  const start = dayOf(value.due);
  const [shown, setShown] = useState({ year: start.getFullYear(), month: start.getMonth() });
  const full = monthGrid(shown.year, shown.month, today);
  // Only the weeks the month occupies: no empty row under the last day.
  const grid = full.slice(0, 7 * Math.ceil((full.map((d) => d.inMonth).lastIndexOf(true) + 1) / 7));
  const step = (by: number) => setShown(({ year, month }) => {
    const next = new Date(year, month + by, 1, 12);
    return { year: next.getFullYear(), month: next.getMonth() };
  });

  return (
    <FloatMenu anchor={anchor} width={240} maxHeight={400} role="group" label="Due day and hour" onClose={onClose} onExtent={onExtent}>
      <div className="date-picker" onKeyDown={(event) => event.key === "Escape" && onClose()}>
        <div className="date-quick" role="group" aria-label="Quick days">
          {QUICK.map((day) => {
            const iso = dayAfter(day.offset);
            return (
              <button key={day.label} type="button" data-active={value.due === iso} onClick={() => { onChange({ due: iso, time: value.time }); onClose(); }}>
                {day.label}
              </button>
            );
          })}
        </div>
        <div className="date-head">
          <span className="date-month">{MONTH.format(new Date(shown.year, shown.month, 1, 12))}</span>
          <button type="button" className="icon-button date-step" data-direction="back" title="Previous month" aria-label="Previous month" onClick={() => step(-1)}><ChevronDown size={9} /></button>
          <button type="button" className="icon-button date-step" data-direction="next" title="Next month" aria-label="Next month" onClick={() => step(1)}><ChevronDown size={9} /></button>
        </div>
        <div className="date-week" aria-hidden="true">{WEEK.map((name) => <span key={name}>{name}</span>)}</div>
        <div className="date-grid" role="grid" aria-label="Days">
          {grid.map((day) => (
            <button
              key={day.iso}
              type="button"
              role="gridcell"
              className="date-day"
              disabled={day.past || !day.inMonth}
              data-out={!day.inMonth}
              data-today={day.iso === today}
              data-selected={day.iso === value.due}
              aria-label={day.iso}
              aria-selected={day.iso === value.due}
              onClick={() => onChange({ due: day.iso, time: value.time })}
            >
              {day.day}
            </button>
          ))}
        </div>
        <div className="date-time">
          <span className="date-time-label">Time</span>
          {value.time === null ? (
            <button type="button" className="date-time-add" onClick={() => onChange({ due: value.due, time: DEFAULT_HOUR })}>Add time</button>
          ) : (
            <>
              <TimeField time={value.time} onChange={(time) => onChange({ due: value.due, time })} />
              <button type="button" className="icon-button time-clear" title="No time (written for 9:00)" aria-label="Remove the time" onClick={() => onChange({ due: value.due, time: null })}><Close size={8} /></button>
            </>
          )}
        </div>
      </div>
    </FloatMenu>
  );
}

/** HH : MM as two small fields: type over them, or step with the arrow keys (the minutes by 5). */
function TimeField({ time, onChange }: { time: string; onChange: (time: string) => void }) {
  const [hour, minute] = time.split(":").map(Number);
  const set = (nextHour: number, nextMinute: number) => onChange(`${two((nextHour + 24) % 24)}:${two((nextMinute + 60) % 60)}`);
  return (
    <span className="time-field">
      <Segment label="Hour" value={hour} max={23} step={1} onChange={(next) => set(next, minute)} />
      <span className="time-colon">:</span>
      <Segment label="Minutes" value={minute} max={59} step={5} onChange={(next) => set(hour, next)} />
    </span>
  );
}

function Segment({ label, value, max, step, onChange }: { label: string; value: number; max: number; step: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && /^\d{1,2}$/.test(draft) && Number(draft) <= max) onChange(Number(draft));
    setDraft(null);
    releaseKeyboardSoon();
  };
  return (
    <input
      className="time-seg"
      aria-label={label}
      inputMode="numeric"
      maxLength={2}
      spellCheck={false}
      autoComplete="off"
      value={draft ?? two(value)}
      onMouseEnter={keyboardOver}
      onMouseDown={keyboardNow}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          setDraft(null);
          onChange(max + 1 > 0 ? (value + (event.key === "ArrowUp" ? step : -step) + max + 1) % (max + 1) : value);
        } else if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
