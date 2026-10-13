import assert from "node:assert/strict";
import { test } from "node:test";
import { CallSoundWatch, SILENT_PEAK } from "../src/call-sound.ts";

/** A loopback whose frames the test plays: 100 ms each, `peak` the loudest sample. */
function setup(startOk = true) {
  let now = 0;
  const listeners = new Set<(pcm: ArrayBuffer) => void>();
  const calls: string[] = [];
  const loopback = {
    start: async () => (calls.push("start"), startOk ? { ok: true } : { ok: false, reason: "no_device" }),
    stop: async () => void calls.push("stop"),
    onPcm: (cb: (pcm: ArrayBuffer) => void) => (listeners.add(cb), () => void listeners.delete(cb)),
  };
  const watch = new CallSoundWatch({ loopback, now: () => now, log: () => {} });
  const frame = (peak: number) => {
    now += 100;
    const samples = new Int16Array(1600);
    samples[800] = peak;
    for (const cb of [...listeners]) cb(samples.buffer);
  };
  const play = (peak: number, frames: number) => {
    for (let i = 0; i < frames; i++) frame(peak);
  };
  return { watch, calls, play, listeners };
}

test("a second of the call's sound (a ring or a voice) is the call starting", async () => {
  const t = setup();
  let heard = 0;
  await t.watch.start(() => void (heard += 1));
  t.play(0, 30);
  assert.equal(heard, 0, "digital silence is nothing playing");
  t.play(SILENT_PEAK + 1, 9);
  assert.equal(heard, 0);
  t.play(SILENT_PEAK + 1, 1);
  assert.equal(heard, 1);
  t.play(5000, 20);
  assert.equal(heard, 1, "said once");
});

test("short sounds apart (a notification) are not a call", async () => {
  const t = setup();
  let heard = 0;
  await t.watch.start(() => void (heard += 1));
  for (let i = 0; i < 10; i++) {
    t.play(4000, 3);
    t.play(0, 20);
  }
  assert.equal(heard, 0);
});

test("the capture that heard the call is handed to the recording, still running", async () => {
  const t = setup();
  await t.watch.start(() => {});
  t.play(3000, 10);
  assert.equal(t.watch.handOver(), true);
  assert.deepEqual(t.calls, ["start"], "not stopped: the recording keeps it");
  assert.equal(t.listeners.size, 0, "the watch no longer listens");
  assert.equal(t.watch.handOver(), false, "handed over once");
});

test("stopping the watch without a call stops the capture; nothing is handed over", async () => {
  const t = setup();
  await t.watch.start(() => {});
  await t.watch.stop();
  assert.deepEqual(t.calls, ["start", "stop"]);
  assert.equal(t.watch.handOver(), false);
});

test("a capture that cannot start is not handed over", async () => {
  const t = setup(false);
  await t.watch.start(() => {});
  assert.equal(t.watch.handOver(), false);
});
