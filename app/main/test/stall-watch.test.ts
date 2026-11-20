import assert from "node:assert/strict";
import { test } from "node:test";
import { createStallWatch, STALL_CHECK_MS } from "../src/stall-watch.ts";

/** A watch on a hand-moved clock: `fire(gap)` moves the clock by `gap` and runs the timer once. */
function watched(mode = "recording") {
  let now = 1_000;
  let fn: (() => void) | null = null;
  const lines: string[] = [];
  const watch = createStallWatch({
    now: () => now,
    every: (_ms, f) => {
      fn = f;
      return () => void (fn = null);
    },
    log: (line) => lines.push(line),
    mode: () => mode,
  });
  watch.start();
  return {
    lines,
    watch,
    fire(gap: number) {
      now += gap;
      fn?.();
    },
  };
}

test("a timer on time writes nothing", () => {
  const w = watched();
  for (let i = 0; i < 20; i += 1) w.fire(STALL_CHECK_MS + 40);
  assert.deepEqual(w.lines, []);
});

test("a timer 1.2 s late is a stall, with what the island was doing", () => {
  const w = watched("recording");
  w.fire(STALL_CHECK_MS + 1200);
  assert.deepEqual(w.lines, ["main thread: stalled 1200 ms (recording)"]);
});

test("under half a second late is not written", () => {
  const w = watched();
  w.fire(STALL_CHECK_MS + 499);
  assert.deepEqual(w.lines, []);
});

test("a gap over a minute is the computer asleep, not a stall", () => {
  const w = watched();
  w.fire(STALL_CHECK_MS + 5 * 60_000);
  assert.deepEqual(w.lines, []);
});

test("at most 30 lines an hour; the rest are counted when the hour ends", () => {
  const w = watched();
  for (let i = 0; i < 35; i += 1) w.fire(STALL_CHECK_MS + 600 + i);
  assert.equal(w.lines.length, 30);
  // The hour ends: one line for the five not written, with the longest of them.
  for (let t = 0; t < 3_600_000; t += STALL_CHECK_MS) w.fire(STALL_CHECK_MS);
  assert.equal(w.lines.length, 31);
  assert.equal(w.lines[30], "main thread: 5 more stalls in the last hour, the longest 634 ms");
});

test("stopped, it writes nothing", () => {
  const w = watched();
  w.watch.stop();
  w.fire(STALL_CHECK_MS + 2000);
  assert.deepEqual(w.lines, []);
});
