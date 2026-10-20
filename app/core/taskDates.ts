// The day and hour of a task, as the island's picker works with them: a calendar day (YYYY-MM-DD) and an optional
// hour (HH:MM), both on the rep's own clock. Pure, so the picker's rules are tested without a window.

export type TaskDue = { due: string; time: string | null };

const two = (n: number) => String(n).padStart(2, "0");

/** A date as YYYY-MM-DD on the rep's own calendar. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The calendar day `iso` names, at local noon (so no timezone shifts it a day). */
export function dayOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function dayAfter(offset: number, from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, 12);
  return isoDay(date);
}

/** The day and hour of an ISO moment (with offset), on the rep's own clock. Null when it isn't one. */
export function dueOfMoment(iso: string | null): TaskDue | null {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return { due: isoDay(at), time: `${two(at.getHours())}:${two(at.getMinutes())}` };
}

export type CalendarDay = { iso: string; day: number; inMonth: boolean; past: boolean };

/** The six weeks that show a month, Monday first, with the days before `today` marked as past. */
export function monthGrid(year: number, month: number, today: string): CalendarDay[] {
  const first = new Date(year, month, 1, 12);
  const lead = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(year, month, 1 - lead + i, 12);
    const iso = isoDay(date);
    return { iso, day: date.getDate(), inMonth: date.getMonth() === month, past: iso < today };
  });
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** How a due day reads: Today, Tomorrow, or "Fri 30 Oct"; the hour follows when there is one ("Tomorrow 16:30"). */
export function dueLabel({ due, time }: { due: string; time?: string | null }, today: Date = new Date()): string {
  const when = dayOf(due);
  const name = due === dayAfter(0, today) ? "Today" : due === dayAfter(1, today) ? "Tomorrow" : `${WEEKDAY.format(when)} ${SHORT_DAY.format(when)}`;
  return time ? `${name} ${time}` : name;
}
