import { useCallback, useState } from "react";
import { dayAfter, dayOf, monthGrid, parseTime, type TaskDue } from "../../core/taskDates.ts";
import { FloatMenu, type Anchor } from "./FloatMenu.tsx";
import { ChevronDown } from "./icons.tsx";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";

/**
 * The day and hour of a task: a month to pick the day from, quick days above it, and the hour below. It floats over the
 * island like the other pickers and never pushes the card down. A day or an hour applies at once; Done only closes it.
 */

const QUICK = [
  { label: "Today", offset: 0 },
  { label: "Tomorrow", offset: 1 },
  { label: "Next week", offset: 7 },
] as const;
const HOURS = ["09:00", "12:00", "16:00"] as const;
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

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
  const [draft, setDraft] = useState(value.time && !(HOURS as readonly string[]).includes(value.time) ? value.time : "");
  const grid = monthGrid(shown.year, shown.month, today);
  const step = (by: number) => setShown(({ year, month }) => {
    const next = new Date(year, month + by, 1, 12);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  const setTime = useCallback((time: string | null) => onChange({ due: value.due, time }), [onChange, value.due]);
  const commitDraft = () => {
    const time = parseTime(draft);
    if (time) {
      setTime(time);
      setDraft((HOURS as readonly string[]).includes(time) ? "" : time);
    } else setDraft(value.time && !(HOURS as readonly string[]).includes(value.time) ? value.time : "");
    releaseKeyboardSoon();
  };

  return (
    <FloatMenu anchor={anchor} width={252} maxHeight={380} role="group" label="Due day and hour" onClose={onClose} onExtent={onExtent}>
      <div className="date-picker">
        <div className="date-quick">
          {QUICK.map((day) => {
            const iso = dayAfter(day.offset);
            return (
              <button key={day.label} type="button" className="small-action task-day" data-active={value.due === iso} onClick={() => { onChange({ due: iso, time: value.time }); onClose(); }}>
                {day.label}
              </button>
            );
          })}
        </div>
        <div className="date-head">
          <button type="button" className="icon-button date-step" data-direction="back" title="Previous month" aria-label="Previous month" onClick={() => step(-1)}><ChevronDown size={9} /></button>
          <span className="date-month">{MONTH.format(new Date(shown.year, shown.month, 1, 12))}</span>
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
              disabled={day.past}
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
          <button type="button" className="small-action task-day" data-active={value.time === null} title="Written for 9:00" onClick={() => { setDraft(""); setTime(null); }}>Any</button>
          {HOURS.map((hour) => (
            <button key={hour} type="button" className="small-action task-day" data-active={value.time === hour} onClick={() => { setDraft(""); setTime(hour); }}>{hour}</button>
          ))}
          <input
            className="date-time-input"
            value={draft}
            placeholder="Other"
            aria-label="Another hour"
            inputMode="numeric"
            maxLength={5}
            spellCheck={false}
            autoComplete="off"
            onMouseEnter={keyboardOver}
            onMouseDown={keyboardNow}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraft();
              } else if (event.key === "Escape") {
                onClose();
              }
            }}
          />
        </div>
        <div className="date-foot">
          <button type="button" className="text-action" onClick={onClose}>Done</button>
        </div>
      </div>
    </FloatMenu>
  );
}
