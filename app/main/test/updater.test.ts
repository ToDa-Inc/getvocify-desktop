import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_EVERY_MS, startUpdater, type UpdateSource } from "../src/updater.ts";

function setup(canInstall: () => boolean) {
  const handlers: Record<string, (arg: never) => void> = {};
  const timers: { ms: number; fn: () => void; stopped: boolean }[] = [];
  const calls = { checks: 0, installs: [] as unknown[][], before: 0 };
  const source = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: async () => void (calls.checks += 1),
    quitAndInstall: (...args: unknown[]) => void calls.installs.push(args),
    on: (event: string, listener: (arg: never) => void) => void (handlers[event] = listener),
  } as unknown as UpdateSource;
  const logs: string[] = [];
  const updater = startUpdater({
    source,
    canInstallNow: canInstall,
    every: (ms, fn) => {
      const t = { ms, fn, stopped: false };
      timers.push(t);
      return () => void (t.stopped = true);
    },
    log: (m) => logs.push(m),
    beforeInstall: () => void (calls.before += 1),
  });
  return { source, handlers, timers, calls, logs, stop: () => updater.stop(), check: () => updater.check() };
}

test("it downloads in the background, accepts pre-releases and checks now and then every half hour", () => {
  const t = setup(() => true);
  assert.equal(t.source.autoDownload, true);
  assert.equal(t.source.autoInstallOnAppQuit, true);
  assert.equal(t.source.allowPrerelease, true);
  assert.equal(t.calls.checks, 1);
  assert.equal(t.timers[0].ms, CHECK_EVERY_MS);
  t.timers[0].fn();
  assert.equal(t.calls.checks, 2);
});

test("a manual check asks now, outside the half-hourly rhythm", () => {
  const t = setup(() => true);
  t.check();
  assert.equal(t.calls.checks, 2);
});

test("a downloaded update is installed at once when nothing is in progress, silently and relaunching", () => {
  const t = setup(() => true);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.deepEqual(t.calls.installs, [[true, true]]);
  assert.equal(t.calls.before, 1, "the app is told first so it can start quietly after the restart");
});

test("while a meeting is being recorded the update waits, and goes in the moment it is free", () => {
  let busy = true;
  const t = setup(() => !busy);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.equal(t.calls.installs.length, 0);
  const waiting = t.timers[1];
  waiting.fn();
  assert.equal(t.calls.installs.length, 0, "still busy");
  busy = false;
  waiting.fn();
  assert.equal(t.calls.installs.length, 1);
});

test("no further checks once an update is downloaded, and errors are logged, never thrown", () => {
  const t = setup(() => false);
  t.handlers.error(new Error("offline") as never);
  assert.match(t.logs.at(-1) ?? "", /offline/);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  const before = t.calls.checks;
  t.timers[0].fn();
  assert.equal(t.calls.checks, before);
  t.stop();
  assert.ok(t.timers.every((x) => x.stopped));
});
