/**
 * The main process stopping for a while, in the log: a timer that should fire every quarter second and comes late says
 * the app's main thread (or the whole computer) did not run for that long. Reps on 8 GB Windows PCs reported the computer
 * freezing mid-call (2026-11-19) and nothing in the log said when; these lines do.
 * A gap over a minute is the computer asleep, not a stall, and is not written. At most 30 lines an hour; the ones over that
 * are counted and said once when the hour ends.
 */
export type StallWatchDeps = {
  /** Milliseconds from a clock that never goes back (performance.now). */
  now(): number;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
  log(line: string): void;
  /** What the island is doing, for the line ("recording", "idle"…). */
  mode(): string;
  /** What the computer was like just before (free memory, how busy), added to the line; absent, nothing is added. */
  context?(): string;
};

export const STALL_CHECK_MS = 250;
/** Late by this much or more is a stall worth a line. */
export const STALL_LOG_MS = 500;
const ASLEEP_MS = 60_000;
const LINES_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

export function createStallWatch(deps: StallWatchDeps): { start(): void; stop(): void } {
  let last = 0;
  let hourStart = 0;
  let lines = 0;
  let unlogged = 0;
  let unloggedLongest = 0;
  let stopTimer: (() => void) | null = null;

  const check = () => {
    const now = deps.now();
    const late = now - last - STALL_CHECK_MS;
    last = now;
    if (now - hourStart >= HOUR_MS) {
      if (unlogged > 0) deps.log(`main thread: ${unlogged} more stalls in the last hour, the longest ${Math.round(unloggedLongest)} ms`);
      hourStart = now;
      lines = 0;
      unlogged = 0;
      unloggedLongest = 0;
    }
    if (late < STALL_LOG_MS || late >= ASLEEP_MS) return;
    if (lines < LINES_PER_HOUR) {
      lines += 1;
      const context = deps.context?.() ?? "";
      deps.log(`main thread: stalled ${Math.round(late)} ms (${deps.mode()})${context ? ` · ${context}` : ""}`);
    } else {
      unlogged += 1;
      unloggedLongest = Math.max(unloggedLongest, late);
    }
  };

  return {
    start() {
      if (stopTimer) return;
      last = deps.now();
      hourStart = last;
      stopTimer = deps.every(STALL_CHECK_MS, check);
    },
    stop() {
      stopTimer?.();
      stopTimer = null;
    },
  };
}
