/**
 * A step of the main process that takes long, in the log by name: the stall watch says the main thread did not answer
 * for a while, and this says which of the app's own steps it was inside, when it was one (a message handled, a window
 * moved, a file written). A stall with no such line next to it was not spent in one of them.
 * At most 30 lines an hour.
 */
export const SLOW_STEP_MS = 200;
const LINES_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

export function createSlowSteps(deps: { now(): number; log(line: string): void }): <T>(name: string | (() => string), step: () => T) => T {
  let hourStart = deps.now();
  let lines = 0;
  return (name, step) => {
    const began = deps.now();
    try {
      return step();
    } finally {
      const took = deps.now() - began;
      if (took >= SLOW_STEP_MS) {
        if (began - hourStart >= HOUR_MS) {
          hourStart = began;
          lines = 0;
        }
        if (lines < LINES_PER_HOUR) {
          lines += 1;
          deps.log(`slow on the main thread: ${typeof name === "function" ? name() : name} took ${Math.round(took)} ms`);
        }
      }
    }
  };
}
