import assert from "node:assert/strict";
import { test } from "node:test";
import { busyBetween, computerLine, cpuTimes, createLoadMeter } from "../src/computer-load.ts";

const cpu = (busy: number, idle: number) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

test("the computer's load is what its processors were not idle for, across all of them", () => {
  const before = cpuTimes([cpu(100, 900), cpu(100, 900)]);
  const after = cpuTimes([cpu(600, 1400), cpu(200, 1800)]);
  assert.equal(busyBetween(before, after), 30, "600 busy of 2000 passed");
  assert.equal(busyBetween(before, before), null, "no time passed: nothing to say");
});

test("the meter says the load since it was last read, and nothing the first time", () => {
  const readings = [cpuTimes([cpu(0, 0)]), cpuTimes([cpu(250, 750)]), cpuTimes([cpu(1250, 750)])];
  const meter = createLoadMeter(() => readings.shift()!);
  assert.equal(meter(), null);
  assert.equal(meter(), 25);
  assert.equal(meter(), 100);
});

test("one line says which computer this is", () => {
  assert.equal(
    computerLine({ platform: "win32", release: "10.0.19045", version: "Windows 10 Pro", cpuModel: "Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz ", processors: 8, totalBytes: 7.9 * 1024 ** 3, onBattery: true }),
    "computer: Windows 10.0.19045 (Windows 10 Pro) · Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz, 8 processors · 7.9 GB · on battery",
  );
  assert.match(computerLine({ platform: "darwin", release: "24.6.0", version: "", cpuModel: "Apple M4", processors: 10, totalBytes: 16 * 1024 ** 3, onBattery: null }), /^computer: macOS \(Darwin\) 24\.6\.0 · Apple M4, 10 processors · 16\.0 GB$/);
});
