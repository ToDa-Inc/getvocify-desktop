import assert from "node:assert/strict";
import { test } from "node:test";
import { createPageHeartbeat, PING_EVERY_MS } from "../src/page-heartbeat.ts";

function watched() {
  let now = 1_000_000;
  let tick: (() => void) | null = null;
  const seen = { pings: 0, ends: 0, lines: [] as string[] };
  const heartbeat = createPageHeartbeat({
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (tick = null);
    },
    ping: () => void (seen.pings += 1),
    end: () => void (seen.ends += 1),
    log: (line) => seen.lines.push(line),
    name: "island",
  });
  heartbeat.start();
  return {
    seen,
    heartbeat,
    /** Moves the clock by `ms` and runs the 10 s timer once. */
    tickAfter(ms: number) {
      now += ms;
      tick?.();
    },
  };
}

test("a page that answers is pinged and never ended", () => {
  const w = watched();
  for (let i = 0; i < 10; i += 1) {
    w.tickAfter(PING_EVERY_MS);
    w.heartbeat.answered();
  }
  assert.equal(w.seen.ends, 0);
  assert.equal(w.seen.pings, 10);
});

test("a page silent for more than 30 s of the app running is ended, once", () => {
  const w = watched();
  for (let i = 0; i < 4; i += 1) w.tickAfter(PING_EVERY_MS);
  assert.equal(w.seen.ends, 1);
  assert.deepEqual(w.seen.lines, ["island: its page did not answer for 30 seconds, ending it"]);
});

test("waking from hours of sleep never ends the page (Toni's island, ten times on 17-18 Nov)", () => {
  const w = watched();
  w.tickAfter(PING_EVERY_MS);
  w.heartbeat.answered();
  // The computer sleeps for three hours: the next tick comes that late.
  w.tickAfter(3 * 60 * 60 * 1000);
  assert.equal(w.seen.ends, 0, "the late tick starts the count again");
  // The page answers on the next ping as usual.
  w.tickAfter(PING_EVERY_MS);
  w.heartbeat.answered();
  w.tickAfter(PING_EVERY_MS);
  assert.equal(w.seen.ends, 0);
});

test("after waking, a page that still never answers is ended after 30 s of the app running", () => {
  const w = watched();
  w.tickAfter(3 * 60 * 60 * 1000);
  for (let i = 0; i < 4; i += 1) w.tickAfter(PING_EVERY_MS);
  assert.equal(w.seen.ends, 1);
});

test("the system's resume event gives the page its full time again", () => {
  const w = watched();
  w.tickAfter(PING_EVERY_MS);
  w.tickAfter(PING_EVERY_MS);
  w.heartbeat.resumed();
  w.tickAfter(PING_EVERY_MS);
  w.tickAfter(PING_EVERY_MS);
  assert.equal(w.seen.ends, 0);
});
