// The Windows implementations against the shared contracts, with Windows itself faked at its edge: the microphone-use
// record `reg query` prints, the long-lived PowerShell reader, Electron's microphone status and the settings pages.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createWindowsCallDetector } from "../src/platform/windows/call-detector.ts";
import { createWindowsCrmScreenReader } from "../src/platform/windows/crm-screen-reader.ts";
import { createWindowsPermissions } from "../src/platform/windows/permissions.ts";
import type { ReaderChild } from "../src/windows/page-reader-process.ts";
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
