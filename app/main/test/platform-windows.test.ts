// The Windows implementations against the shared contracts, with Windows itself faked at its edge: the microphone-use
// record `reg query` prints, the long-lived PowerShell reader, Electron's microphone status and the settings pages.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createWindowsCallDetector } from "../src/platform/windows/call-detector.ts";
import { createReaderSource } from "../src/windows/reader-source.ts";
import { createWindowsCrmScreenReader } from "../src/platform/windows/crm-screen-reader.ts";
import { createWindowsPermissions } from "../src/platform/windows/permissions.ts";
import type { ReaderChild } from "../src/windows/page-reader-process.ts";
import type { DetectedCaller } from "../src/platform/types.ts";
import { callDetectorContract } from "./contracts/call-detector.contract.ts";
import { crmScreenReaderContract } from "./contracts/crm-screen-reader.contract.ts";
import { permissionsContract } from "./contracts/permissions.contract.ts";
import { phoneDialerContract } from "./contracts/phone-dialer.contract.ts";
import { createWindowsPhone } from "../src/platform/windows/phone.ts";

const START = 1_800_000_000_000;
const KEY = "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";
const ZOOM = "C:\\Program Files\\Zoom\\bin\\Zoom.exe";
const VOCIFY = "C:\\Users\\rep\\AppData\\Local\\Programs\\Vocify\\Vocify.exe";
/** FILETIME for a ms-since-epoch time, as `reg query` prints it. */
const filetime = (ms: number) => `0x${((BigInt(ms) + 11644473600000n) * 10000n).toString(16)}`;
const entry = (path: string, started: number, stopped: number) =>
  `${KEY}\\NonPackaged\\${path.replace(/\\/g, "#")}\n    Value    REG_SZ    Allow\n    LastUsedTimeStart    REG_QWORD    ${started ? filetime(started) : "0x0"}\n    LastUsedTimeStop    REG_QWORD    ${stopped ? filetime(stopped) : "0x0"}\n`;

callDetectorContract("Windows", () => {
  let now = START;
  const held = new Map<string, { started: number; stopped: number }>();
  let tick: (() => void) | null = null;
  const detector = createWindowsCallDetector({
    read: async () => [...held].map(([path, use]) => entry(path, use.started, use.stopped)).join(""),
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (tick = null);
    },
    ownExePath: VOCIFY,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    detector,
    zoomStarts: () => void held.set(ZOOM, { started: now, stopped: 0 }),
    zoomStops: () => void held.set(ZOOM, { started: held.get(ZOOM)?.started ?? now, stopped: now }),
    vocifyStarts: () => void held.set(VOCIFY, { started: now, stopped: 0 }),
    advance: async (ms) => {
      await settle();
      now += ms;
      tick?.();
      await settle();
      await settle();
    },
  };
});

/** Windows with its privacy record silent (the registry is not written): only the capture sessions show the call. */
callDetectorContract("Windows (capture sessions only)", () => {
  let now = START;
  const holding = new Map<string, number>();
  let report: ((line: string) => void) | null = null;
  const send = () =>
    report?.(`CAPTURE ${JSON.stringify([...holding].map(([path, pid]) => ({ pid, app: path.slice(path.lastIndexOf("\\") + 1).replace(/\.exe$/i, ""), path, id: `${pid}-1` })))}`);
  let tick: (() => void) | null = null;
  const detector = createWindowsCallDetector({
    read: async () => "",
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (tick = null);
    },
    ownExePath: VOCIFY,
    captureReader: {
      start(onLine) {
        report = onLine;
        send();
      },
      stop() {
        report = null;
      },
    },
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    detector,
    zoomStarts: () => {
      holding.set(ZOOM, 4242);
      send();
    },
    zoomStops: () => {
      holding.delete(ZOOM);
      send();
    },
    vocifyStarts: () => {
      holding.set(VOCIFY, 5150);
      send();
    },
    advance: async (ms) => {
      await settle();
      now += ms;
      tick?.();
      await settle();
      await settle();
    },
  };
});

/** A PowerShell reader that answers `front` and `page` from what the test says is on screen. */
function fakeReader(screen: { front: string | null; url: string | null; dead: boolean }) {
  const stdout = new EventEmitter();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stdin: {
      write(line: string) {
        const command = line.trim();
        const answer = command === "front" ? (screen.front ?? "") : command === "page" && screen.url ? `${screen.front}\t${screen.url}` : "";
        setImmediate(() => (screen.dead ? child.emit("exit", 1) : stdout.emit("data", Buffer.from(`${answer}\r\n<<END>>\r\n`))));
        return true;
      },
    },
    kill: () => child.emit("exit", 1),
  });
  return child;
}

crmScreenReaderContract("Windows", () => {
  const screen = { front: null as string | null, url: null as string | null, dead: false };
  const reader = createWindowsCrmScreenReader({
    spawn: () => fakeReader(screen) as unknown as ReaderChild,
    now: () => (screen.dead ? 1_000 : 0), // a dead reader is not restarted within the minute
  });
  return {
    reader,
    chrome: "chrome",
    notABrowser: "excel",
    chromeShows: (url) => Object.assign(screen, { front: "chrome", url, dead: false }),
    otherAppInFront: () => Object.assign(screen, { front: "excel", url: null }),
    osCannotAnswer: () => void (screen.dead = true),
  };
});

permissionsContract("Windows", () => {
  let microphone = "not-determined";
  const opened: string[] = [];
  return {
    permissions: createWindowsPermissions({ microphoneAccess: () => microphone, openExternal: (url) => void opened.push(url) }),
    platform: "win32",
    microphoneIs: (raw) => void (microphone = raw),
    repAllowsBrowsers: () => {}, // Windows reads the address bars without asking
    prompts: () => [], // Windows has no per-app prompt
    opened: () => opened,
  };
});

const windowsPhone = (telApp: string) => {
  const opened: string[] = [];
  return {
    dialer: createWindowsPhone({ telApp: () => telApp, openExternal: (url) => void opened.push(url), openSoundRecording: () => void opened.push("sound:recording") }),
    opened: () => opened.filter((url) => url.startsWith("tel:")),
    setupOpened: () => opened.filter((url) => !url.startsWith("tel:")),
  };
};

phoneDialerContract("Windows", () => windowsPhone("Phone Link"), () => windowsPhone(""));

test("Windows phone: setting up opens Default apps, where Phone Link becomes the app for TEL links", async () => {
  const h = windowsPhone("");
  await h.dialer.setup();
  assert.deepEqual(h.setupOpened(), ["ms-settings:defaultapps"]);
});

test("Windows phone: 'they can't hear me' opens the Sound dialog on its Recording tab", async () => {
  const h = windowsPhone("Phone Link");
  await h.dialer.micSettings();
  assert.deepEqual(h.setupOpened(), ["sound:recording"]);
});

test("Windows phone: after the link, Phone Link's Call is pressed for that same number", async () => {
  const pressed: string[] = [];
  const dialer = createWindowsPhone({ telApp: () => "Enlace Móvil", openExternal: () => {}, openSoundRecording: () => {}, pressCall: (number) => void pressed.push(number) });
  await dialer.dial("+34 600-111 222");
  assert.deepEqual(pressed, ["+34600111222"]);
  await dialer.dial("abc");
  assert.deepEqual(pressed, ["+34600111222"], "nothing is pressed for a number that was not opened");
});

test("Windows phone: once the call has started, the press still waiting is stopped", () => {
  let stopped = 0;
  const dialer = createWindowsPhone({ telApp: () => "Enlace Móvil", openExternal: () => {}, openSoundRecording: () => {}, pressCall: () => {}, stopPressing: () => void (stopped += 1) });
  dialer.callStarted();
  assert.equal(stopped, 1);
});

/** Windows with the reader reporting the record itself: the registry is asked only while the reader is silent. */
test("Windows reads the record through its reader, asks the registry only while the reader is silent, and logs an error once", async () => {
  let now = START;
  let registryReads = 0;
  let report: ((line: string) => void) | null = null;
  const errors: string[] = [];
  const callers: (DetectedCaller | null)[] = [];
  let tick: (() => void) | null = null;
  const detector = createWindowsCallDetector({
    read: async () => {
      registryReads += 1;
      return "";
    },
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (tick = null);
    },
    ownExePath: VOCIFY,
    captureReader: {
      start(onLine) {
        report = onLine;
      },
      stop() {
        report = null;
      },
    },
    onCaptureError: (line) => errors.push(line),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const zoom = `CONSENT [{"k":"NonPackaged\\\\C#Program Files#Zoom#bin#Zoom.exe","s":"${(BigInt(START - 60_000) + 11644473600000n) * 10000n}","e":"0"}]`;
  detector.start((caller) => callers.push(caller));
  await settle();
  assert.equal(registryReads, 0, "no registry query while the reader is still starting");
  now += 20_000;
  tick?.();
  await settle();
  assert.equal(registryReads, 0, "still none 20 s in: a slow PC's reader takes that long");
  const asked = registryReads;
  report?.(zoom);
  await settle();
  assert.equal(callers.at(-1)?.name, "Zoom", "the call is seen from the reader's record, at once");
  now += 2000;
  tick?.();
  await settle();
  assert.equal(registryReads, asked, "no registry query while the reader reports");
  report?.("CONSENT_ERROR access denied");
  report?.("CONSENT_ERROR access denied");
  assert.deepEqual(errors, ["CONSENT_ERROR access denied"], "the same error is logged once");
  detector.stop();
});

test("Windows: a reader that never reports is replaced by the registry after 45 s, asked every 10 s, not at every look", async () => {
  let now = START;
  let registryReads = 0;
  const notes: string[] = [];
  let tick: (() => void) | null = null;
  const callers: (DetectedCaller | null)[] = [];
  const detector = createWindowsCallDetector({
    read: async () => {
      registryReads += 1;
      return entry(ZOOM, now - 5000, 0);
    },
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => void (tick = null);
    },
    ownExePath: VOCIFY,
    captureReader: { start() {}, stop() {} },
    onCaptureError: (line) => notes.push(line),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const look = async (ms: number) => {
    now += ms;
    tick?.();
    await settle();
    await settle();
  };
  detector.start((caller) => callers.push(caller));
  await settle();
  for (let i = 0; i < 20; i += 1) await look(2000);
  assert.equal(registryReads, 0, "40 s in, the reader may still be starting");
  for (let i = 0; i < 15; i += 1) await look(2000);
  // 30 s of looks every 2 s past the grace: the registry is asked about every 10 s, not 15 times.
  assert.ok(registryReads >= 2 && registryReads <= 4, `asked ${registryReads} times`);
  assert.equal(callers.at(-1)?.name, "Zoom", "the call is still seen, through the registry");
  assert.equal(notes.filter((n) => n.includes("asking the registry")).length, 1, "said once");
  detector.stop();
});

/* ---------- the native helper, with PowerShell behind it ---------- */

function fakeSpawn() {
  const started: { file: string; args: string[]; child: EventEmitter }[] = [];
  const spawnProcess = ((file: string, args: string[]) => {
    const child = new EventEmitter();
    started.push({ file, args, child });
    return child;
  }) as unknown as Parameters<typeof createReaderSource>[0]["spawnProcess"];
  return { started, spawnProcess };
}
const KIND = { command: "capture" as const, script: "Write-Output 1" };

test("Windows readers: the native helper is started with its command and the app's pid; without one, PowerShell runs the script", () => {
  const withHelper = fakeSpawn();
  const source = createReaderSource({ helperPath: "C:\\app\\vocify-win-helper.exe", log: () => {}, now: () => 0, spawnProcess: withHelper.spawnProcess });
  source.start(KIND, ["ignore", "pipe", "pipe"]);
  assert.equal(withHelper.started[0].file, "C:\\app\\vocify-win-helper.exe");
  assert.deepEqual(withHelper.started[0].args, ["capture", "--parent", String(process.pid)]);

  const without = fakeSpawn();
  createReaderSource({ helperPath: null, log: () => {}, now: () => 0, spawnProcess: without.spawnProcess }).start(KIND, ["ignore", "pipe", "pipe"]);
  assert.equal(without.started[0].file, "powershell.exe");
  assert.ok(without.started[0].args.includes("-EncodedCommand"));
});

test("Windows readers: a helper that cannot start is given up, said once, and PowerShell takes over at once", () => {
  const fake = fakeSpawn();
  const logs: string[] = [];
  let restarted = 0;
  const source = createReaderSource({ helperPath: "helper.exe", log: (line) => logs.push(line), now: () => 0, spawnProcess: fake.spawnProcess });
  source.start(KIND, ["ignore", "pipe", "pipe"], () => {
    restarted += 1;
    source.start(KIND, ["ignore", "pipe", "pipe"]);
  });
  fake.started[0].child.emit("error", new Error("spawn EPERM"));
  assert.equal(restarted, 1);
  assert.equal(source.usesHelper(), false);
  assert.equal(fake.started[1].file, "powershell.exe", "the same reader again, through PowerShell");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not start \(spawn EPERM\); the PowerShell readers are used instead/);
});

test("Windows readers: a helper that ends at once with an error is given up; one stopped by the app, or ending later, is not", () => {
  let now = 0;
  const fake = fakeSpawn();
  const logs: string[] = [];
  const source = createReaderSource({ helperPath: "helper.exe", log: (line) => logs.push(line), now: () => now, spawnProcess: fake.spawnProcess });
  source.start(KIND, ["ignore", "pipe", "pipe"]);
  fake.started[0].child.emit("exit", null); // killed by the app (no exit code)
  assert.equal(source.usesHelper(), true);
  source.start(KIND, ["ignore", "pipe", "pipe"]);
  now = 60_000;
  fake.started[1].child.emit("exit", 1); // a crash a minute in: not a helper that cannot run here
  assert.equal(source.usesHelper(), true);
  source.start(KIND, ["ignore", "pipe", "pipe"]);
  now = 61_000;
  fake.started[2].child.emit("exit", 2);
  assert.equal(source.usesHelper(), false);
  assert.match(logs[0], /ended at start with code 2/);
});
