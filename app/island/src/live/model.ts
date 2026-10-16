// What the live assistant's pieces read, worked out once from the pushed view and the rep's own marks. Pure: the views
// only draw it.
import type { LiveProgress, LivePoint, LiveOutcome } from "../types.ts";
import type { LiveStrings } from "../../../core/liveWording.ts";

/** Responder reads the last minute of the call. */
export const RESPOND_WINDOW_S = 60;
/** How long a card takes to fold away into Antes, in ms (the CSS `live-item-fold`). */
export const CLOSE_MS = 420;
/** How long Responder's pulse on a card lasts. */
export const FLASH_MS = 1200;

/** The rep's own ticks (true) and unticks (false), by `kind:id`: final over the brain's. */
export type Marks = Record<string, boolean>;
export const markKey = (kind: "step" | "data" | "goal", id: string) => `${kind}:${id}`;

export type Todo = {
  key: string;
  id: string;
  kind: "step" | "data" | "goal";
  label: string;
  /** The step's few words and criterion, or the data's good answer: the tooltip of a name with nothing to ask. */
  hint: string;
  done: boolean;
  byRep: boolean;
  /** Done rows: the prospect's words that prove it, or the value and words. */
  detail: string | null;
  /** What to ask or say for it. */
  ask: string | null;
};

/** Steps, what to find out and the goal in one list, in the order that matters now: the brain's picks first, then the
 * steps in the playbook's order, then the data still unknown, the goal last. The rep's own ticks win. */
export function todos(progress: LiveProgress, marks: Marks, words: LiveStrings): Todo[] {
  const decided = (key: string, brainDone: boolean, brainByRep: boolean) => (key in marks ? { done: marks[key], byRep: true } : { done: brainDone, byRep: brainDone && brainByRep });
  const steps: Todo[] = progress.steps.map((step) => {
    const key = markKey("step", step.id);
    return {
      key, id: step.id, kind: "step", label: step.label,
      hint: [step.concept, step.criterion].filter(Boolean).join(". "),
      ...decided(key, step.done, step.byRep), detail: step.quote, ask: step.example,
    };
  });
  const data: Todo[] = progress.data.map((item) => {
    const key = markKey("data", item.id);
    return {
      key, id: item.id, kind: "data", label: item.label, hint: item.good || item.label,
      ...decided(key, item.done, item.byRep),
      detail: item.value ? [item.value, item.quote, item.reread ? words.reread : null].filter(Boolean).join(" · ") : null,
      ask: item.question,
    };
  });
  const goal = progress.goal;
  const key = markKey("goal", "goal");
  const goalTodo: Todo[] = goal ? [{ key, id: "goal", kind: "goal", label: goal.label ?? words.goal, hint: words.goalHint, ...decided(key, goal.done, goal.byRep), detail: goal.value, ask: null }] : [];
  // The brain's picks first, then the steps in the playbook's order, then the data still unknown, the goal last.
  const picked = progress.missing;
  const rank = (todo: Todo) => {
    const at = picked.indexOf(todo.id);
    return at >= 0 ? at : picked.length + (todo.kind === "step" ? 0 : todo.kind === "data" ? 100 : 200);
  };
  return [...steps, ...data, ...goalTodo].sort((a, b) => rank(a) - rank(b));
}

/** Ahora: the one thing that matters most now and has something to say. The brain's pick while it stands; else the first
 * pending item with something to say. One answer, read by Conversación and by Preguntar. */
export function nowTodo(progress: LiveProgress, marks: Marks, words: LiveStrings): Todo | null {
  if (!progress.hasPlaybook) return null;
  const list = todos(progress, marks, words);
  const pick = progress.now;
  if (pick) {
    const found = list.find((todo) => todo.kind === pick.kind && todo.id === pick.id && !todo.done);
    const say = pick.say ?? found?.ask ?? null;
    if (found && say) return { ...found, ask: say };
  }
  return list.find((todo) => !todo.done && todo.ask) ?? null;
}

/** What still matters, minus what the rep has ticked themself: the Conversación tab's count and the bar's chip. */
export function stillMissing(progress: LiveProgress, marks: Marks, words: LiveStrings): Todo[] {
  if (!progress.hasPlaybook) return [];
  const list = todos(progress, marks, words);
  return progress.missing.flatMap((id) => {
    const todo = list.find((item) => item.id === id);
    return todo && !todo.done ? [todo] : [];
  });
}

/** A point as the rep sees it: closed by their X, or brought back by Responder, before the dashboard says so. */
export type PointOverlay = { dismissed: string[]; reopened: string[] };
export type ShownPhase = "thinking" | "writing" | "ready" | "closing" | "closed";
/** `landed`: it was drawn as a draft with these same words a moment ago, so it takes the draft's place without entering. */
export type ShownPoint = LivePoint & { shown: ShownPhase; landed: boolean };

export const isEnded = (outcome: LiveOutcome) => outcome !== "open";

/** The effective outcome of a point once the rep's own X (and Responder bringing it back) is applied. */
export function effectiveOutcome(point: LivePoint, overlay: PointOverlay): LiveOutcome {
  if (overlay.reopened.includes(point.id)) return "open";
  if (overlay.dismissed.includes(point.id)) return "dismissed";
  return point.outcome;
}

export const tagOf = (point: LivePoint, words: LiveStrings) =>
  point.tag ?? (point.kind === "question" ? words.question : words.kinds[point.tagKey] ?? words.objection);

/** Points open and not folding away: what the Ayuda tab counts, the chip names, and Responder can point at. */
export const waitingPoints = (points: ShownPoint[]) => points.filter((point) => point.shown !== "closed" && point.shown !== "closing");

/** Seconds into the call (the clock minus pauses): what `saidAt` is measured in. */
export function callSeconds(clock: { startedAt: number; pausedMs: number; pausedAt: number | null } | null, now: number): number {
  if (!clock) return 0;
  const end = clock.pausedAt ?? now;
  return Math.max(0, (end - clock.startedAt - clock.pausedMs) / 1000);
}

/** Said within Responder's window, up to now. */
export const inWindow = (point: LivePoint, seconds: number) => point.saidAt >= seconds - RESPOND_WINDOW_S && point.saidAt <= seconds + 1;

/** `mm:ss` into the call. */
export function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
