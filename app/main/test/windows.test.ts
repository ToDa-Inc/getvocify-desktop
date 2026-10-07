import assert from "node:assert/strict";
import { test } from "node:test";
import { crmUrlsOf, createPageReader, encodePowerShell, normalizeAddress, parsePageOutput, READ_PAGES_SCRIPT } from "../src/windows/browser-pages.ts";
import { callAppFor, filetimeToMs, MicWatcher, parseMicConsent, pickCaller, type DetectedCaller, type MicUse } from "../src/windows/mic-use.ts";

/* ---------- microphone use ---------- */

/** FILETIME for a ms-since-epoch time, as `reg query` prints it. */
const filetime = (ms: number) => `0x${((BigInt(ms) + 11644473600000n) * 10000n).toString(16)}`;

const KEY = "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";
const app = (path: string, started: number, stopped: number) =>
  `${KEY}\\NonPackaged\\${path.replace(/\\/g, "#")}\n    Value    REG_SZ    Allow\n    LastUsedTimeStart    REG_QWORD    ${started === 0 ? "0x0" : filetime(started)}\n    LastUsedTimeStop    REG_QWORD    ${stopped === 0 ? "0x0" : filetime(stopped)}\n`;
const store = (family: string, started: number, stopped: number) =>
  `${KEY}\\${family}\n    Value    REG_SZ    Allow\n    LastUsedTimeStart    REG_QWORD    ${filetime(started)}\n    LastUsedTimeStop    REG_QWORD    ${stopped === 0 ? "0x0" : filetime(stopped)}\n`;

const NOW = 1_800_000_000_000;

test("a Windows FILETIME becomes ms since 1970", () => {
  assert.equal(filetimeToMs(132539328000000000n), 1609459200000, "2021-01-01T00:00:00Z");
  assert.equal(filetimeToMs(0n), 0);
});

test("the microphone record is read into apps, desktop and Store, and containers are not apps", () => {
  const output = [
    `${KEY}\nValue    REG_SZ    Allow\n`,
    `${KEY}\\NonPackaged\n`,
    app("C:\\Program Files\\Zoom\\bin\\Zoom.exe", NOW - 60_000, 0),
    app("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", NOW - 600_000, NOW - 500_000),
    store("MSTeams_8wekyb3d8bbwe", NOW - 5_000, 0),
  ].join("\n");
  const uses = parseMicConsent(output);
  assert.deepEqual(uses.map((u) => u.exe), ["zoom.exe", "chrome.exe", "msteams_8wekyb3d8bbwe"]);
  assert.equal(uses[0].path, "C:\\Program Files\\Zoom\\bin\\Zoom.exe");
  assert.deepEqual(uses.map((u) => u.active), [true, false, true]);
  assert.equal(uses[0].started, NOW - 60_000);
  assert.equal(uses[2].path, null);
});

test("an app is active only while its start is newer than its stop", () => {
  const [a, b, c] = parseMicConsent([app("C:\\x\\a.exe", 5000, 0), app("C:\\x\\b.exe", 9000, 5000), app("C:\\x\\c.exe", 4000, 8000)].join("\n"));
  assert.deepEqual([a.active, b.active, c.active], [true, true, false]);
  assert.equal(parseMicConsent(app("C:\\x\\never.exe", 0, 0))[0].active, false, "never used");
});

test("damaged or empty output gives no apps and never throws", () => {
  assert.deepEqual(parseMicConsent(""), []);
  assert.deepEqual(parseMicConsent("ERROR: The system was unable to find the specified registry key or value."), []);
  const odd = `${KEY}\\NonPackaged\\C:#x#y.exe\n    LastUsedTimeStart    REG_QWORD    not-a-number\n`;
  assert.equal(parseMicConsent(odd)[0].active, false);
});

test("call apps by desktop executable and by Store package family", () => {
  assert.equal(callAppFor("Zoom.exe")?.name, "Zoom");
  assert.equal(callAppFor("ms-teams.exe")?.name, "Microsoft Teams");
  assert.equal(callAppFor("MSTeams_8wekyb3d8bbwe")?.name, "Microsoft Teams");
  assert.equal(callAppFor("msteams_8wekyb3d8bbwe_variant")?.name, "Microsoft Teams");
  assert.equal(callAppFor("chrome.exe")?.browser, true);
  assert.equal(callAppFor("slack.exe")?.browser, false);
  assert.equal(callAppFor("granola.exe"), null, "note-takers use the microphone too and are not calls");
  assert.equal(callAppFor("wispr flow.exe"), null);
});

const use = (exe: string, started: number, extra: Partial<MicUse> = {}): MicUse => ({ id: `C:\\x\\${exe}`, path: `C:\\x\\${exe}`, exe, started, stopped: 0, active: true, ...extra });

test("the caller is the call app that has held the mic long enough, a named app before a browser", () => {
  const options = { now: NOW, settleMs: 300 };
  assert.equal(pickCaller([use("chrome.exe", NOW - 5000), use("zoom.exe", NOW - 4000)], options)?.name, "Zoom");
  assert.equal(pickCaller([use("chrome.exe", NOW - 5000)], options)?.name, "Google Chrome");
  assert.equal(pickCaller([use("zoom.exe", NOW - 100)], options), null, "a blip is skipped");
  assert.equal(pickCaller([use("zoom.exe", NOW - 5000, { active: false })], options), null);
  assert.equal(pickCaller([use("granola.exe", NOW - 5000), use("wispr.exe", NOW - 5000)], options), null);
  assert.equal(pickCaller([], options), null);
});

test("Vocify's own microphone use is never a call", () => {
  const own = "C:\\Users\\a\\AppData\\Local\\Programs\\Vocify\\Vocify.exe";
  const uses = [use("vocify.exe", NOW - 5000, { path: own, id: own })];
  assert.equal(pickCaller(uses, { now: NOW, settleMs: 300, ownExePath: own }), null);
  assert.equal(pickCaller(uses, { now: NOW, settleMs: 300, ownExePath: own.toLowerCase().replace(/\\/g, "/") }), null, "case and slashes do not matter");
});

function watcherSetup(outputs: (() => string | Error)[]) {
  let now = NOW;
  let polls = 0;
  const callers: (DetectedCaller | null)[] = [];
  let tick: (() => void) | null = null;
  let stopped = false;
  const errors: unknown[] = [];
  const watcher = new MicWatcher({
    read: async () => {
      const next = outputs[Math.min(polls, outputs.length - 1)]();
      polls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (stopped = true);
    },
    ownExePath: null,
    onCaller: (caller) => callers.push(caller),
    onError: (error) => errors.push(error),
  });
  const advance = async (ms: number) => {
    now += ms;
    tick?.();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { watcher, callers, advance, polls: () => polls, isStopped: () => stopped, errors };
}

test("the watcher reports a call when it starts and when it ends, and nothing in between", async () => {
  const quiet = () => "";
  const zoom = () => app("C:\\Program Files\\Zoom\\bin\\Zoom.exe", NOW - 10_000, 0);
  const t = watcherSetup([quiet, quiet, zoom, zoom, zoom, quiet]);
  t.watcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(t.callers, [null], "the first answer is reported once, even when it is 'no call'");
  await t.advance(1000);
  assert.equal(t.callers.length, 1);
  await t.advance(1000);
  assert.equal(t.callers.at(-1)?.name, "Zoom");
  await t.advance(1000);
  await t.advance(1000);
  assert.equal(t.callers.length, 2, "the same call is not reported again");
  await t.advance(1000);
  assert.equal(t.callers.at(-1), null);
});

test("a call that only just started is reported once it has settled", async () => {
  let start = NOW + 100;
  const fresh = () => app("C:\\Program Files\\Zoom\\bin\\Zoom.exe", start, 0);
  const t = watcherSetup([fresh]);
  t.watcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(t.callers, [null]);
  await t.advance(1000);
  assert.equal(t.callers.at(-1)?.name, "Zoom", "the same record, but its start is now older than the settle time");
  start = 0;
});

test("a failing read is reported and the next poll still works; halting stops the polling", async () => {
  const zoom = () => app("C:\\Program Files\\Zoom\\bin\\Zoom.exe", NOW - 10_000, 0);
  const t = watcherSetup([() => new Error("reg.exe failed"), zoom]);
  t.watcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(t.errors.length, 1);
  await t.advance(1000);
  assert.equal(t.callers.at(-1)?.name, "Zoom");
  t.watcher.halt();
  assert.equal(t.isStopped(), true);
});

/* ---------- browser pages ---------- */

test("an address bar's text becomes a URL, with the scheme the browser hides", () => {
  assert.equal(normalizeAddress("app.hubspot.com/contacts/123/contact/456"), "https://app.hubspot.com/contacts/123/contact/456");
  assert.equal(normalizeAddress("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(normalizeAddress("  acme.pipedrive.com/person/9  "), "https://acme.pipedrive.com/person/9");
  assert.equal(normalizeAddress("chrome://newtab"), "chrome://newtab");
  assert.equal(normalizeAddress("what is the weather"), null, "a search is not a page");
  assert.equal(normalizeAddress(""), null);
  assert.equal(normalizeAddress("localhost"), null);
});

test("the script's lines become pages, and only CRM links are kept for the dashboard", () => {
  const output = ["chrome\tapp.hubspot.com/contacts/123/contact/456", "msedge\tmeet.google.com/abc-defg-hij", "chrome\tacme.pipedrive.com/person/9", "firefox\tnews.ycombinator.com", "garbage line", "chrome\tapi.pipedrive.com/x", "chrome\thttp://app.hubspot.com/insecure"].join("\r\n");
  const pages = parsePageOutput(output);
  assert.equal(pages.length, 6);
  assert.deepEqual(crmUrlsOf(pages), ["https://app.hubspot.com/contacts/123/contact/456", "https://acme.pipedrive.com/person/9"]);
});

test("the script is sent as encoded text and never walks a page's content", () => {
  assert.equal(Buffer.from(encodePowerShell(READ_PAGES_SCRIPT), "base64").toString("utf16le"), READ_PAGES_SCRIPT);
  assert.match(READ_PAGES_SCRIPT, /\$CT::Document\) \{ continue \}/, "Document controls (the page) are skipped");
  assert.match(READ_PAGES_SCRIPT, /Chrome_WidgetWin_1/);
  assert.match(READ_PAGES_SCRIPT, /MozillaWindowClass/);
});

test("the page reader shares one run, reuses a recent answer, and never throws", async () => {
  let runs = 0;
  let now = 0;
  const slow = createPageReader(
    async () => {
      runs += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return "chrome\tapp.hubspot.com/contacts/1/contact/2\n";
    },
    () => now,
    1500,
  );
  const [a, b] = await Promise.all([slow.read(), slow.read()]);
  assert.equal(runs, 1, "two callers at once share one run");
  assert.deepEqual(a, b);
  now = 1000;
  await slow.read();
  assert.equal(runs, 1, "a recent answer is reused");
  now = 2000;
  await slow.read();
  assert.equal(runs, 2);
  const broken = createPageReader(async () => {
    throw new Error("powershell missing");
  }, () => 0);
  assert.deepEqual(await broken.read(), []);
});
