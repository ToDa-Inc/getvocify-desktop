import assert from "node:assert/strict";
import { test } from "node:test";
import { CallSource } from "../../core/callSource.ts";
import type { Caller } from "../src/controller.ts";
import { createBrowserCallWatch } from "../src/windows/browser-call.ts";

/** The browser's pages and time, moved by hand. */
function setup() {
  let source: CallSource | null = null;
  let reads = 0;
  const timers = new Set<() => void>();
  const offered: Caller[] = [];
  const watch = createBrowserCallWatch({
    readSource: async () => {
      reads += 1;
      return source;
    },
    announce: (caller) => offered.push(caller),
    every: (_ms, fn) => {
      timers.add(fn);
      return () => void timers.delete(fn);
    },
  });
  const tick = async () => {
    for (const fn of [...timers]) fn();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { watch, offered, tick, showing: (next: CallSource | null) => void (source = next), reads: () => reads, running: () => timers.size };
}

const chrome = { appId: "chrome.exe", icon: "data:icon" };
const meet = new CallSource("Google Meet", "meeting");

test("a browser holding the microphone is not a call by itself: nothing is offered", async () => {
  const t = setup();
  t.watch.held(chrome);
  await t.tick();
  await t.tick();
  assert.deepEqual(t.offered, []);
});

test("once a page says it is Google Meet, the call is offered under that name, once", async () => {
  const t = setup();
  t.watch.held(chrome);
  await t.tick();
  t.showing(meet);
  await t.tick();
  assert.deepEqual(t.offered, [{ name: "Google Meet", appId: "chrome.exe", icon: "data:icon" }]);
  await t.tick();
  t.watch.held(chrome);
  await t.tick();
  assert.equal(t.offered.length, 1);
});

test("a meeting that is already open when the browser starts holding the microphone is offered at once", async () => {
  const t = setup();
  t.showing(meet);
  t.watch.held(chrome);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(t.offered.length, 1);
});

test("it stops looking once offered, and when the browser lets go", async () => {
  const t = setup();
  t.showing(meet);
  t.watch.held(chrome);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(t.running(), 0);
  const t2 = setup();
  t2.watch.held(chrome);
  assert.equal(t2.running(), 1);
  t2.watch.released();
  assert.equal(t2.running(), 0);
  const before = t2.reads();
  t2.showing(meet);
  await t2.tick();
  assert.equal(t2.reads(), before);
  assert.deepEqual(t2.offered, []);
});

test("a page that is read after the browser let go does not offer a call", async () => {
  let release: (source: CallSource | null) => void = () => {};
  const offered: Caller[] = [];
  const watch = createBrowserCallWatch({
    readSource: () => new Promise((resolve) => (release = resolve)),
    announce: (caller) => offered.push(caller),
    every: () => () => {},
  });
  watch.held(chrome);
  watch.released();
  release(meet);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(offered, []);
});

test("another browser takes over the watch", async () => {
  const t = setup();
  t.showing(meet);
  t.watch.held(chrome);
  await new Promise((resolve) => setImmediate(resolve));
  t.watch.released();
  t.watch.held({ appId: "msedge.exe", icon: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(t.offered.map((c) => c.appId), ["chrome.exe", "msedge.exe"]);
});
