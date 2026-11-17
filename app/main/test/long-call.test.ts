import { test } from "node:test";
import assert from "node:assert/strict";
import v8 from "node:v8";
import { IslandController, type Effects } from "../src/controller.ts";

/**
 * A 60-minute call through the shell: the dashboard sends a change to its overlay for each transcript update (what it
 * changed, from the first changed turn on), and the island is sent the change and the rest of the state. What goes to the
 * island per update is counted at the start, the middle and the end of the call: it must not grow with the call.
 */
test("the island is sent about the same per update at minute 60 as at minute 1", () => {
  let now = 0;
  let sentBytes = 0;
  let sentTurns = 0;
  const effects: Effects = {
    now: () => now,
    after: () => () => {},
    emit: () => {},
    showMainWindow: () => {},
    onState: () => {},
    onLevels: () => {},
    saveRecorderReady: () => {},
  };
  const controller = new IslandController(effects, { notchWidth: 185, barHeight: 32, screenHeight: 982 }, { recorderReady: true, material: "opaque", reduceMotion: false });
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(" ");
  // Each update: the last turn is the one being said (a changed turn), and every fourth second a new turn comes after it.
  const perMinute: { minute: number; bytes: number; turns: number }[] = [];
  let turnCount = 0;
  let minuteBytes = 0;
  let minuteTurns = 0;
  let minuteUpdates = 0;
  for (let step = 0; step < 60 * 60 * 4; step++) {
    now += 250;
    if (step % 16 === 0) turnCount += 1;
    const last = turnCount - 1;
    const sentWords = Math.min(40, 1 + (step % 16) * 2 + (random() < 0.1 ? 3 : 0));
    const changed = { key: `t${last}`, you: last % 2 === 0, label: last % 2 === 0 ? null : "Them", text: words(sentWords), pending: "" };
    controller.applyShellState({ overlay: { from: last, turns: [changed] } });
    // What the island is sent for this update: the change, and the state without its turns.
    const change = controller.takeTurnsChange();
    const { turns: _turns, ...rest } = controller.state;
    const bytes = (change ? v8.serialize(change).length : 0) + v8.serialize(rest).length;
    sentBytes += bytes;
    if (change) sentTurns += change.turns.length;
    minuteBytes += bytes;
    minuteTurns += change ? change.turns.length : 0;
    minuteUpdates += 1;
    if ((step + 1) % (60 * 4) === 0) {
      perMinute.push({ minute: (step + 1) / (60 * 4), bytes: minuteBytes / minuteUpdates, turns: minuteTurns / minuteUpdates });
      minuteBytes = 0;
      minuteTurns = 0;
      minuteUpdates = 0;
    }
  }
  assert.equal(controller.state.turns.length, turnCount, "the island's list holds every turn of the call");
  assert.ok(sentBytes > 0 && sentTurns > 0);
  const average = (from: number, to: number, pick: (m: { bytes: number; turns: number }) => number) => {
    const inRange = perMinute.filter((m) => m.minute >= from && m.minute <= to);
    return inRange.reduce((sum, m) => sum + pick(m), 0) / inRange.length;
  };
  const bytesStart = average(1, 3, (m) => m.bytes);
  const bytesEnd = average(58, 60, (m) => m.bytes);
  const turnsStart = average(1, 3, (m) => m.turns);
  const turnsEnd = average(58, 60, (m) => m.turns);
  assert.ok(bytesEnd <= bytesStart * 2 + 100, `island bytes per update grew from ${bytesStart.toFixed(0)} to ${bytesEnd.toFixed(0)}`);
  assert.ok(turnsEnd <= turnsStart * 2 + 1, `turns sent per update grew from ${turnsStart.toFixed(2)} to ${turnsEnd.toFixed(2)}`);
});
