import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "./icons.tsx";
import type { BackgroundJob, IslandAction, IslandState } from "./types.ts";
import { BACKGROUND_LINE } from "./geometry.ts";

/**
 * The calls the dashboard is still finishing, so the next recording or call never waits for them: one glyph beside the clock
 * while recording (no space taken), and one line under the open island otherwise. Three states for the rep: working, needs you
 * (an update to review, or one that failed), and done. They never open a card by themselves.
 */

type Act = (action: IslandAction) => void;
type State = BackgroundJob["state"];

const needsRep = (job: BackgroundJob) => job.state === "needs" || job.state === "failed";
const ORDER: Record<State, number> = { failed: 0, needs: 1, working: 2, followup: 3, done: 4 };
const byUrgency = (jobs: BackgroundJob[]) => [...jobs].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
const who = (job: BackgroundJob) => job.name ?? "Last call";

/** The same few words everywhere: after a name, and in a count. */
const PHRASE: Record<State, string> = { working: "writing up", needs: "to review", failed: "couldn't write", followup: "no answer", done: "saved" };
/** What the one action on a call is called, by its state. */
const ACTION: Partial<Record<State, { label: string; type: "openJob" | "retryJob" }>> = {
  needs: { label: "Review", type: "openJob" },
  failed: { label: "Retry", type: "retryJob" },
  followup: { label: "Follow up", type: "openJob" },
  // A saved call can be opened again: the same card, as it ended.
  done: { label: "Open", type: "openJob" },
};

function Mark({ state }: { state: State }): ReactNode {
  if (state === "working") return <span className="job-spin" aria-label="Working" />;
  if (state === "needs") return <span className="job-dot" />;
  if (state === "failed") return <span className="job-dot" data-bad />;
  return <Check size={10} stroke={3} />;
}

/** In a recording: beside the clock, one glyph and no count (the ear has no room, and a dot means one thing): a dot when something waits for the rep, a spinner while any is working, a tick when all is saved. Not a control: the calls wait for the rep after this one. */
export function JobsBadge({ state }: { state: IslandState }) {
  const jobs = state.background ?? [];
  const need = jobs.filter(needsRep).length;
  const working = jobs.some((job) => job.state === "working");
  if (need === 0 && !working) return null;
  const failed = jobs.some((job) => job.state === "failed");
  const title = need > 0 ? `${need} to review after the call` : working ? "Finishing the last call" : "The last call is saved";
  return (
    <span className="job-badge" title={title} aria-label={title}>
      {need > 0 ? <span className="job-dot" data-bad={failed || undefined} /> : <span className="job-spin" />}
    </span>
  );
}

/** What the line steps through: what still needs the rep, most urgent first, then the calls already saved, the latest first. */
const steps = (jobs: BackgroundJob[]) => [...byUrgency(jobs.filter((job) => job.state !== "done")), ...jobs.filter((job) => job.state === "done").reverse()];

/**
 * Under the open island: one line, always one call. A glyph for where it is, its name and state in the same few words, and its
 * one action. When there are more, two small arrows step to the others, the ones already saved included. It starts on the most
 * urgent and goes back to it whenever something changes, so what needs the rep is never behind an arrow.
 */
export function JobsLine({ state, act }: { state: IslandState; act: Act }) {
  const jobs = steps(state.background ?? []);
  const [at, setAt] = useState(0);
  const key = jobs.map((job) => `${job.id}:${job.state}`).join(",");
  useEffect(() => setAt(0), [key]);
  const job = jobs[Math.min(at, jobs.length - 1)];
  if (!job) return null;
  const action = ACTION[job.state];
  const step = (by: number) => (event: { stopPropagation(): void }) => { event.stopPropagation(); setAt((i) => Math.max(0, Math.min(jobs.length - 1, i + by))); };
  return (
    <div className="job-line" style={{ height: BACKGROUND_LINE }} data-state={job.state}>
      <Mark state={job.state} />
      <span className="job-text">{who(job)} · {PHRASE[job.state]}</span>
      {jobs.length > 1 && (
        <span className="job-steps">
          <button type="button" className="job-step" data-dir="prev" title="Previous call" aria-label="Previous call" disabled={at === 0} onClick={step(-1)}><ChevronDown size={9} stroke={3} /></button>
          <button type="button" className="job-step" data-dir="next" title="Next call" aria-label="Next call" disabled={at >= jobs.length - 1} onClick={step(1)}><ChevronDown size={9} stroke={3} /></button>
        </span>
      )}
      {action && <button type="button" className="text-action" onClick={(event) => { event.stopPropagation(); act({ name: "postCall", type: action.type, details: { id: job.id } }); }}>{action.label}</button>}
    </div>
  );
}

/** The closed island's mark for the same thing: a spinner while something is working, the count when something needs the rep. */
export function jobsIndicator(state: Pick<IslandState, "background">): { working: boolean; need: number; failed: boolean } | null {
  const jobs = state.background ?? [];
  if (jobs.length === 0) return null;
  const need = jobs.filter(needsRep).length;
  const working = jobs.some((job) => job.state === "working");
  return need > 0 || working ? { working, need, failed: jobs.some((job) => job.state === "failed") } : null;
}
