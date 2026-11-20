/**
 * Whether a page still answers: the main process pings it every 10 s and its preload answers on the page's own thread. A
 * page that has not answered for 30 s of the app running is ended (a hung page cannot reload itself), and loads again.
 *
 * Time the computer spent asleep is not the page's silence. A rep's island was ended at every wake from sleep (Toni,
 * Windows, 17 and 18 Nov 2026: ten times, each right after "resumed from sleep"), because the wall clock had moved on by
 * hours while nothing ran. A tick that comes late (the app was not running) starts the count again instead.
 */
export type PageHeartbeatDeps = {
  /** Milliseconds, wall clock (Date.now). */
  now(): number;
  every(ms: number, fn: () => void): () => void;
  ping(): void;
  /** The page did not answer in time: end it (it loads again). */
  end(): void;
  log(line: string): void;
  /** For the log line ("island"). */
  name: string;
};

export const PING_EVERY_MS = 10_000;
export const SILENT_LIMIT_MS = 30_000;
/** A tick this late means the app was not running (asleep, or the computer stalled): not the page's fault. */
const LATE_TICK_MS = 2 * PING_EVERY_MS;

export function createPageHeartbeat(deps: PageHeartbeatDeps) {
  let lastAnswer = deps.now();
  let lastTick = deps.now();
  let stop: (() => void) | null = null;

  const tick = () => {
    const now = deps.now();
    const late = now - lastTick > LATE_TICK_MS;
    lastTick = now;
    if (late) {
      // Back from sleep (or a long stall of the whole app): the page gets its full time again from now.
      lastAnswer = now;
      deps.ping();
      return;
    }
    if (now - lastAnswer > SILENT_LIMIT_MS) {
      lastAnswer = now;
      deps.log(`${deps.name}: its page did not answer for 30 seconds, ending it`);
      deps.end();
      return;
    }
    deps.ping();
  };

  return {
    start() {
      lastAnswer = deps.now();
      lastTick = deps.now();
      stop ??= deps.every(PING_EVERY_MS, tick);
    },
    /** The page answered (a pong), or loaded again. */
    answered() {
      lastAnswer = deps.now();
    },
    /** The computer woke: the page gets its full time again. */
    resumed() {
      lastAnswer = deps.now();
      lastTick = deps.now();
    },
    stop() {
      stop?.();
      stop = null;
    },
  };
}
