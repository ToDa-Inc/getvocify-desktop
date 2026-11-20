import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECK_EVERY_MS, OFFER_AGAIN_MS, startUpdater, type UpdateSource } from "../src/updater.ts";

function setup(canInstall: () => boolean, canRestart?: () => boolean, now: () => number = () => 1000) {
  const handlers: Record<string, (arg: never) => void> = {};
  const timers: { ms: number; fn: () => void; stopped: boolean }[] = [];
  const calls = { checks: 0, installs: [] as unknown[][], before: 0, notices: [] as { version: string; restart: () => void }[] };
  const source = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates: async () => void (calls.checks += 1),
    quitAndInstall: (...args: unknown[]) => void calls.installs.push(args),
    on: (event: string, listener: (arg: never) => void) => void (handlers[event] = listener),
  } as unknown as UpdateSource;
  const logs: string[] = [];
  const states: string[] = [];
  const updater = startUpdater({
    onState: (s) => void states.push(s.state),
    now,
    source,
    canInstallNow: canInstall,
    canRestartNow: canRestart,
    notify: (version, restart) => void calls.notices.push({ version, restart }),
    every: (ms, fn) => {
      const t = { ms, fn, stopped: false };
      timers.push(t);
      return () => void (t.stopped = true);
    },
    log: (m) => logs.push(m),
    beforeInstall: () => void (calls.before += 1),
  });
  return { source, handlers, timers, calls, logs, states, updater, stop: () => updater.stop(), check: () => updater.check() };
}

test("Settings sees each step: checking, then up to date", () => {
  const t = setup(() => true);
  assert.deepEqual(t.updater.state(), { state: "idle" });
  t.handlers["checking-for-update"](undefined as never);
  t.handlers["update-not-available"](undefined as never);
  assert.deepEqual(t.states, ["checking", "current"]);
  assert.deepEqual(t.updater.state(), { state: "current", checkedAt: 1000 });
});

test("Settings sees a newer build download and become ready; a later check does not hide it", () => {
  const t = setup(() => false);
  t.handlers["checking-for-update"](undefined as never);
  t.handlers["update-available"]({ version: "0.4.9" } as never);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  t.handlers["checking-for-update"](undefined as never);
  t.handlers.error(new Error("offline") as never);
  assert.deepEqual(t.states, ["checking", "downloading", "ready"]);
  assert.deepEqual(t.updater.state(), { state: "ready", next: "0.4.9" });
});

test("a failed check says why", () => {
  const t = setup(() => true);
  t.handlers.error(new Error("net::ERR_INTERNET_DISCONNECTED") as never);
  assert.deepEqual(t.updater.state(), { state: "failed", reason: "net::ERR_INTERNET_DISCONNECTED", checkedAt: 1000 });
});

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

test("a downloaded update is offered at once when nothing is in progress, and never installed by itself", () => {
  const t = setup(() => true);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.deepEqual(t.calls.notices.map((n) => n.version), ["0.4.9"]);
  assert.equal(t.calls.installs.length, 0, "the app does not restart on its own");
  assert.equal(t.calls.before, 0);
});

test("while a meeting is being recorded the offer waits, and comes the moment it is free", () => {
  let busy = true;
  const t = setup(() => !busy);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.equal(t.calls.notices.length, 0);
  const waiting = t.timers[1];
  waiting.fn();
  assert.equal(t.calls.notices.length, 0, "still busy");
  busy = false;
  waiting.fn();
  assert.equal(t.calls.notices.length, 1);
  waiting.fn();
  assert.equal(t.calls.notices.length, 1, "not again at once");
  assert.equal(t.calls.installs.length, 0);
});

test("the same build is offered again only after four hours, a newer build at once", () => {
  let at = 1000;
  const t = setup(() => true, undefined, () => at);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  at += OFFER_AGAIN_MS - 1;
  t.timers[1].fn();
  assert.equal(t.calls.notices.length, 1);
  at += 1;
  t.timers[1].fn();
  assert.equal(t.calls.notices.length, 2);
  t.handlers["update-downloaded"]({ version: "0.5.0" } as never);
  assert.equal(t.calls.notices.at(-1)?.version, "0.5.0");
  assert.equal(t.calls.installs.length, 0);
});

test("clicking the offer restarts into the build, and a click during a recording waits", () => {
  let busy = false;
  const t = setup(() => !busy, () => !busy);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  busy = true;
  t.calls.notices[0].restart();
  assert.equal(t.calls.installs.length, 0, "still recording");
  busy = false;
  t.calls.notices[0].restart();
  assert.deepEqual(t.calls.installs, [[true, true]]);
  assert.equal(t.calls.before, 1, "the app is told first so it can start quietly after the restart");
});

test("checks go on after a download, and a newer build replaces the one waiting; errors are logged, never thrown", () => {
  const t = setup(() => true);
  t.handlers.error(new Error("offline") as never);
  assert.match(t.logs.at(-1) ?? "", /offline/);
  t.handlers["update-downloaded"]({ version: "0.4.395" } as never);
  assert.equal(t.calls.notices.at(-1)?.version, "0.4.395");
  const before = t.calls.checks;
  t.timers[0].fn();
  assert.equal(t.calls.checks, before + 1, "the half-hourly check still runs");
  t.handlers["update-downloaded"]({ version: "0.4.396" } as never);
  assert.deepEqual(t.updater.state(), { state: "ready", next: "0.4.396" });
  assert.equal(t.calls.notices.at(-1)?.version, "0.4.396", "the newest is offered at once");
  t.stop();
  assert.ok(t.timers.every((x) => x.stopped));
});

test("a disk too full to unpack the update says so, and Restart is no longer offered for it", () => {
  const t = setup(() => true);
  t.handlers["update-downloaded"]({ version: "0.4.395" } as never);
  t.handlers.error(new Error("ditto: /Users/x/Library/Caches/com.vocify.app.ShipIt/update.9weHHrF/Vocify.app/Contents/x/locale.pak: No space left on device") as never);
  const state = t.updater.state();
  assert.equal(state.state, "failed");
  assert.match(state.state === "failed" ? state.reason : "", /Not enough free space/);
  assert.equal(t.updater.install(), false, "nothing to restart into");
});

test("a restart that never quits says so after 20 s instead of waiting forever", () => {
  const later: (() => void)[] = [];
  const handlers: Record<string, (arg: never) => void> = {};
  const logs: string[] = [];
  const updater = startUpdater({
    source: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      checkForUpdates: async () => undefined,
      quitAndInstall: () => undefined,
      on: (event: string, listener: (arg: never) => void) => void (handlers[event] = listener),
    } as unknown as UpdateSource,
    canInstallNow: () => true,
    every: () => () => undefined,
    log: (m) => logs.push(m),
    now: () => 1000,
    after: (_ms, fn) => void later.push(fn),
  });
  handlers["update-downloaded"]({ version: "0.4.395" } as never);
  assert.equal(updater.install(), true);
  assert.equal(later.length, 1);
  later[0]();
  const state = updater.state();
  assert.equal(state.state, "failed");
  assert.match(state.state === "failed" ? state.reason : "", /could not restart into 0\.4\.395/);
  assert.match(logs.at(-1) ?? "", /still running 20 s after restarting/);
});

test("Restart now installs the downloaded build at once, and refuses while a recording makes it wait", () => {
  let busy = true;
  const t = setup(() => !busy);
  assert.equal(t.updater.install(), false, "nothing downloaded yet");
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.equal(t.updater.install(), false, "still recording");
  assert.equal(t.calls.installs.length, 0);
  busy = false;
  assert.equal(t.updater.install(), true);
  assert.deepEqual(t.calls.installs, [[true, true]]);
});

test("an open window holds the offer back, but not Restart now", () => {
  let windowOpen = true;
  const t = setup(() => !windowOpen, () => true);
  t.handlers["update-downloaded"]({ version: "0.4.9" } as never);
  assert.equal(t.calls.notices.length, 0, "the rep is looking at the app");
  assert.equal(t.updater.install(), true);
  assert.equal(t.calls.installs.length, 1);
  windowOpen = false;
});
