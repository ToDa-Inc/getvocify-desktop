/**
 * The main process stopping for a while, in the log: a timer that should fire every quarter second and comes late says
 * the app's main thread (or the whole computer) did not run for that long. Reps on 8 GB Windows PCs reported the computer
 * freezing mid-call (2026-11-19) and nothing in the log said when; these lines do.
 * A gap over a minute is the computer asleep, not a stall, and is not written. A shorter one next to the computer sleeping
 * or waking, or to the app closing, is written as a pause, not a stall: of 185 stall lines on five PCs, 46 were the
 * computer asleep and 13 the app closing (2026-11-25). At most 30 lines an hour; the ones over that
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
  /** What this process has used since it started: processor time (ms), page faults and disk writes. Read at every check,
   * so a stall's line says what the process did while it was not answering: all the time on the processor is the app's own
   * code; none, with many page faults, is its memory coming back from disk; none and few is a wait on something else. */
  usage?(): { cpuMs: number; faults: number; writes: number };
  /** Runs `fn` once after `ms`. With `notAStall`, the line waits two seconds for the reason to be known. */
  after?(ms: number, fn: () => void): void;
  /** Why a gap is not the app stalling ("the computer was asleep", "the app was closing"), or null. Asked two seconds
   * after the gap: a computer waking up says so only after its timers have already come late. */
  notAStall?(): string | null;
};

/** How long after a gap the reason for it is asked. */
export const STALL_REASON_AFTER_MS = 2000;

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
  let lastUsage = deps.usage?.() ?? null;

  const check = () => {
    const now = deps.now();
    const late = now - last - STALL_CHECK_MS;
    last = now;
    const usage = deps.usage?.() ?? null;
    const used = usage && lastUsage ? { cpuMs: usage.cpuMs - lastUsage.cpuMs, faults: usage.faults - lastUsage.faults, writes: usage.writes - lastUsage.writes } : null;
    lastUsage = usage;
    if (now - hourStart >= HOUR_MS) {
      if (unlogged > 0) deps.log(`main thread: ${unlogged} more stalls in the last hour, the longest ${Math.round(unloggedLongest)} ms`);
      hourStart = now;
      lines = 0;
      unlogged = 0;
      unloggedLongest = 0;
    }
    if (late < STALL_LOG_MS || late >= ASLEEP_MS) return;
    const mode = deps.mode();
    const context = deps.context?.() ?? "";
    const did = used ? ` · used ${Math.max(0, Math.round(used.cpuMs))} ms of processor, ${Math.max(0, used.faults)} page faults, ${Math.max(0, used.writes)} disk writes` : "";
    const write = () => {
      const why = deps.notAStall?.() ?? null;
      if (why) return deps.log(`main thread: paused ${Math.round(late)} ms, ${why}`);
      if (lines < LINES_PER_HOUR) {
        lines += 1;
        deps.log(`main thread: stalled ${Math.round(late)} ms (${mode})${did}${context ? ` · ${context}` : ""}`);
      } else {
        unlogged += 1;
        unloggedLongest = Math.max(unloggedLongest, late);
      }
    };
    if (deps.notAStall && deps.after) deps.after(STALL_REASON_AFTER_MS, write);
    else write();
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
