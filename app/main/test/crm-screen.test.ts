import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createCrmScreenWatcher } from "../src/crm-screen-watcher.ts";
import { createPageReaderProcess, type ReaderChild } from "../src/windows/page-reader-process.ts";

const HUBSPOT_CONTACT = "https://app-eu1.hubspot.com/contacts/147506535/record/0-1/901";

/** A clock the test moves by hand; `tick` runs the interval callbacks due and lets their promises settle. */
function fakeClock() {
  let now = 0;
  const intervals: { every: number; next: number; fn: () => void; live: boolean }[] = [];
  return {
    every(ms: number, fn: () => void) {
      const timer = { every: ms, next: now + ms, fn, live: true };
      intervals.push(timer);
      return () => void (timer.live = false);
    },
    async tick(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = intervals.filter((t) => t.live && t.next <= target).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.every;
        due.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = target;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function watcherSetup() {
  const clock = fakeClock();
  const state = { front: "slack" as string | null, urls: [] as string[], reads: 0, delay: null as Promise<void> | null };
  const emitted: string[][] = [];
  const watcher = createCrmScreenWatcher({
    front: async () => state.front,
    read: async (_app: string) => {
      state.reads += 1;
      if (state.delay) await state.delay;
      return state.urls;
    },
    isBrowser: (app) => app === "chrome" || app === "msedge",
    emit: (urls) => emitted.push(urls),
    every: clock.every,
  });
  watcher.start();
  return { clock, state, emitted, watcher };
}

test("reads only while a browser is in front, and sends the pages once per change", async () => {
  const t = watcherSetup();
  await t.clock.tick(1500);
  assert.equal(t.state.reads, 0);
  t.state.front = "chrome";
  t.state.urls = [HUBSPOT_CONTACT];
  await t.clock.tick(1500);
  assert.deepEqual(t.emitted, [[HUBSPOT_CONTACT]]);
  await t.clock.tick(1500);
  assert.equal(t.emitted.length, 1);
  t.state.urls = [];
  await t.clock.tick(1500);
  assert.deepEqual(t.emitted, [[HUBSPOT_CONTACT], []]);
});

test("another app in front keeps the last record (nothing is sent)", async () => {
  const t = watcherSetup();
  t.state.front = "chrome";
  t.state.urls = [HUBSPOT_CONTACT];
  await t.clock.tick(1500);
  t.state.front = "explorer";
  await t.clock.tick(3000);
  assert.deepEqual(t.emitted, [[HUBSPOT_CONTACT]]);
});

test("a slow read is never stacked: the next ticks are skipped until it answers", async () => {
  const t = watcherSetup();
  let release!: () => void;
  t.state.delay = new Promise<void>((resolve) => (release = resolve));
  t.state.front = "msedge";
  await t.clock.tick(1500);
  await t.clock.tick(1500);
  await t.clock.tick(1500);
  assert.equal(t.state.reads, 1);
  release();
  await t.clock.tick(0);
  t.state.delay = null;
  await t.clock.tick(1500);
  assert.equal(t.state.reads, 2);
});

test("a read that fails sends nothing", async () => {
  const t = watcherSetup();
  t.state.front = "chrome";
  t.state.urls = null as unknown as string[];
  await t.clock.tick(1500);
  assert.deepEqual(t.emitted, []);
});

/** A child process that answers each command line with what the test queued, then the end marker. */
function fakeChild(answers: Record<string, string>) {
  const stdout = new EventEmitter();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stdin: {
      written: [] as string[],
      write(line: string) {
        this.written.push(line);
        const command = line.trim();
        setImmediate(() => stdout.emit("data", Buffer.from(`${answers[command] ?? ""}\r\n<<END>>\r\n`)));
        return true;
      },
    },
    kill() {
      child.emit("exit", 1);
    },
  });
  return child;
}

test("one long-lived reader answers front and read in order", async () => {
  let spawned = 0;
  const child = fakeChild({ front: "chrome", read: `chrome\t${HUBSPOT_CONTACT}\r\nmsedge\twww.google.com` });
  const reader = createPageReaderProcess(() => {
    spawned += 1;
    return child as unknown as ReaderChild;
  }, () => 0);
  const [front, pages] = await Promise.all([reader.front(), reader.read()]);
  assert.equal(front, "chrome");
  assert.deepEqual(pages.map((p) => p.url), [HUBSPOT_CONTACT, "https://www.google.com"]);
  assert.equal(spawned, 1);
  assert.deepEqual(child.stdin.written, ["front\n", "read\n"]);
});

test("a reader that dies answers nothing and is restarted at most once a minute", async () => {
  let now = 0;
  const children: ReturnType<typeof fakeChild>[] = [];
  const reader = createPageReaderProcess(() => {
    const child = fakeChild({ front: "chrome" });
    children.push(child);
    return child as unknown as ReaderChild;
  }, () => now);
  assert.equal(await reader.front(), "chrome");
  children[0].emit("exit", 1);
  now = 10_000;
  assert.equal(await reader.front(), null);
  assert.equal(children.length, 1);
  now = 61_000;
  assert.equal(await reader.front(), "chrome");
  assert.equal(children.length, 2);
});
