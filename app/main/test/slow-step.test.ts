import assert from "node:assert/strict";
import { test } from "node:test";
import { createSlowSteps } from "../src/slow-step.ts";

test("a step that takes long is written by name; a quick one is not, and its result comes back either way", () => {
  let now = 0;
  const lines: string[] = [];
  const timed = createSlowSteps({ now: () => now, log: (line) => lines.push(line) });
  assert.equal(timed("a quick step", () => { now += 50; return 7; }), 7);
  assert.equal(timed(() => "writing the draft", () => { now += 840; return "ok"; }), "ok");
  assert.deepEqual(lines, ["slow on the main thread: writing the draft took 840 ms"]);
});

test("a step that throws is still timed, and the error goes on", () => {
  let now = 0;
  const lines: string[] = [];
  const timed = createSlowSteps({ now: () => now, log: (line) => lines.push(line) });
  assert.throws(() => timed("a step that fails", () => { now += 300; throw new Error("no"); }), /no/);
  assert.deepEqual(lines, ["slow on the main thread: a step that fails took 300 ms"]);
});

test("at most 30 lines an hour", () => {
  let now = 0;
  const lines: string[] = [];
  const timed = createSlowSteps({ now: () => now, log: (line) => lines.push(line) });
  for (let i = 0; i < 40; i += 1) timed("slow", () => void (now += 250));
  assert.equal(lines.length, 30);
  now += 3_600_000;
  timed("slow", () => void (now += 250));
  assert.equal(lines.length, 31);
});
