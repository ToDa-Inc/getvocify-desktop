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

test("a stall's line says what the computer was like just before, when the app can tell", () => {
  let now = 1_000;
  let fn: (() => void) | null = null;
  const lines: string[] = [];
  createStallWatch({
    now: () => now,
    every: (_ms, f) => {
      fn = f;
      return () => void (fn = null);
    },
    log: (line) => lines.push(line),
    mode: () => "idle",
    context: () => "free 0.3 GB, computer CPU 97% just before",
  }).start();
  now += STALL_CHECK_MS + 2600;
  (fn as (() => void) | null)?.();
  assert.deepEqual(lines, ["main thread: stalled 2600 ms (idle) · free 0.3 GB, computer CPU 97% just before"]);
});

test("a stall's line says what the process did meanwhile: processor used, page faults, disk writes", () => {
  let now = 1_000;
  let fn: (() => void) | null = null;
  const lines: string[] = [];
  const readings = [{ cpuMs: 100, faults: 10, writes: 1 }, { cpuMs: 112, faults: 3410, writes: 3 }];
  createStallWatch({
    now: () => now,
    every: (_ms, f) => {
      fn = f;
      return () => void (fn = null);
    },
    log: (line) => lines.push(line),
    mode: () => "recording",
    usage: () => readings.shift() ?? { cpuMs: 112, faults: 3410, writes: 3 },
  }).start();
  now += STALL_CHECK_MS + 900;
  (fn as (() => void) | null)?.();
  assert.deepEqual(lines, ["main thread: stalled 900 ms (recording) · used 12 ms of processor, 3400 page faults, 2 disk writes"]);
});

test("a gap next to the computer sleeping or the app closing is a pause, not a stall, once the reason is known", () => {
  let now = 1_000;
  let fn: (() => void) | null = null;
  let reason: string | null = null;
  const lines: string[] = [];
  const later: (() => void)[] = [];
  createStallWatch({
    now: () => now,
    every: (_ms, f) => {
      fn = f;
      return () => void (fn = null);
    },
    log: (line) => lines.push(line),
    mode: () => "idle",
    after: (_ms, f) => void later.push(f),
    notAStall: () => reason,
  }).start();
  now += STALL_CHECK_MS + 7000;
  (fn as (() => void) | null)?.();
  assert.deepEqual(lines, [], "nothing is written until the reason can be known");
  reason = "the computer was asleep";
  later.shift()?.();
  assert.deepEqual(lines, ["main thread: paused 7000 ms, the computer was asleep"]);
  reason = null;
  now += STALL_CHECK_MS + 800;
  (fn as (() => void) | null)?.();
  later.shift()?.();
  assert.equal(lines[1], "main thread: stalled 800 ms (idle)");
});
