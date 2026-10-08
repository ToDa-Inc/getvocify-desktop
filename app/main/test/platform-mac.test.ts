// The Mac implementations against the shared contracts, with macOS faked at its edge: `osascript` (the app in front and
// the browser's tabs), Electron's microphone status and prompt, the settings pages, and the rep's answer to "Vocify wants
// to control Google Chrome", and the native helper (native/mac-helper/PROTOCOL.md) as a fake child process.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createMacCallDetector } from "../src/platform/mac/call-detector.ts";
import { createMacCrmScreenReader } from "../src/platform/mac/crm-screen-reader.ts";
import type { HelperChild } from "../src/platform/mac/helper.ts";
import { createMacPermissions } from "../src/platform/mac/permissions.ts";
import { createMacSystemAudio } from "../src/platform/mac/system-audio.ts";
import type { Status } from "../src/platform/types.ts";
import { callDetectorContract } from "./contracts/call-detector.contract.ts";
import { crmScreenReaderContract } from "./contracts/crm-screen-reader.contract.ts";
import { permissionsContract } from "./contracts/permissions.contract.ts";
import { systemAudioContract } from "./contracts/system-audio.contract.ts";

const FRONT_APP = "id of application (path to frontmost application as text)";

/** `osascript` answering from what the test says is on screen. */
function fakeOsascript(screen: { front: string | null; url: string | null; dead: boolean; consent: "granted" | "denied" }) {
  return async (_file: string, args: string[]): Promise<string> => {
    if (screen.dead) throw new Error("osascript timed out");
    const script = args[1] ?? "";
    if (script === FRONT_APP) return `${screen.front ?? ""}\n`;
    if (/ is running$/.test(script)) return "true\n";
    if (screen.consent === "denied") throw new Error("Not authorized to send Apple events to Google Chrome. (-1743)");
    return screen.front === "com.google.Chrome" && screen.url ? `${screen.url}\n` : "\n";
  };
}

crmScreenReaderContract("Mac", () => {
  const screen = { front: null as string | null, url: null as string | null, dead: false, consent: "granted" as const };
  const reader = createMacCrmScreenReader({ exec: fakeOsascript(screen), access: () => "authorized" });
  return {
    reader,
    chrome: "com.google.Chrome",
    notABrowser: "com.microsoft.Excel",
    chromeShows: (url) => Object.assign(screen, { front: "com.google.Chrome", url, dead: false }),
    otherAppInFront: () => Object.assign(screen, { front: "com.microsoft.Excel", url: null }),
    osCannotAnswer: () => void (screen.dead = true),
  };
});

permissionsContract("Mac", () => {
  let microphone = "not-determined";
  let crmTabs: Status | undefined;
  const screen = { front: "com.google.Chrome", url: null, dead: false, consent: "denied" as "granted" | "denied" };
  const prompts: string[] = [];
  const opened: string[] = [];
  return {
    permissions: createMacPermissions({
      microphoneAccess: () => microphone,
      askMicrophone: async () => {
        prompts.push("microphone");
        return true;
      },
      openExternal: (url) => void opened.push(url),
      exec: async (file, args, timeout) => {
        if (args[1] !== FRONT_APP && !/ is running$/.test(args[1] ?? "")) prompts.push("crmTabs");
        return fakeOsascript(screen)(file, args);
      },
      crmTabs: { get: () => crmTabs, set: (value) => void (crmTabs = value) },
      audioAccess: { status: () => "authorized", ask: async () => {} },
    }),
    platform: "darwin",
    microphoneIs: (raw) => void (microphone = raw),
    repAllowsBrowsers: () => void (screen.consent = "granted"),
    prompts: () => prompts.filter((p) => p === "microphone"),
    opened: () => opened,
  };
});

/** vocify-mac-helper as a child process the test speaks for (see native/mac-helper/PROTOCOL.md). */
function fakeHelper() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: () => child.kill() },
    killed: false,
    kill() {
      if (child.killed) return;
      child.killed = true;
      setImmediate(() => child.emit("exit", 0));
    },
  });
  return child;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const line = (stream: EventEmitter, value: unknown) => stream.emit("data", Buffer.from(`${JSON.stringify(value)}\n`));

systemAudioContract("Mac", () => {
  let helper: ReturnType<typeof fakeHelper> | null = null;
  const audio = createMacSystemAudio({
    spawn: (command) => {
      if (command !== "audio") throw new Error(`unexpected helper command ${command}`);
      helper = fakeHelper();
      const started = helper;
      setImmediate(() => line(started.stderr, { event: "started" }));
      return started as unknown as HelperChild;
    },
  });
  return {
    audio,
    captures: true,
    osPlays: async (bytes) => {
      // In uneven pieces, as a pipe delivers them.
      for (let sent = 0; sent < bytes; sent += 1234) {
        if (helper && !helper.killed) helper.stdout.emit("data", Buffer.alloc(Math.min(1234, bytes - sent)));
      }
      await tick();
    },
    osEnds: async () => {
      if (!helper) return;
      line(helper.stderr, { event: "lost", reason: "device_changed" });
      helper.emit("exit", 0);
      await tick();
    },
  };
});

systemAudioContract("Mac without permission", () => ({
  audio: createMacSystemAudio({
    spawn: () => {
      const helper = fakeHelper();
      setImmediate(() => {
        line(helper.stderr, { event: "error", reason: "permission_denied" });
        helper.emit("exit", 1);
      });
      return helper as unknown as HelperChild;
    },
  }),
  captures: false,
  osPlays: async () => {},
  osEnds: async () => {},
}));

callDetectorContract("Mac", () => {
  let helper: ReturnType<typeof fakeHelper> | null = null;
  const using = new Map<string, { bundleId: string; name: string; pid: number; path: string }>();
  const report = () => helper && !helper.killed && line(helper.stdout, { event: "mic", apps: [...using.values()] });
  const detector = createMacCallDetector({
    spawn: (command) => {
      if (command !== "mic") throw new Error(`unexpected helper command ${command}`);
      helper = fakeHelper();
      setImmediate(report);
      return helper as unknown as HelperChild;
    },
    ownBundleId: "com.vocify.app",
  });
  return {
    detector,
    zoomStarts: () => {
      using.set("zoom", { bundleId: "us.zoom.xos", name: "zoom.us", pid: 501, path: "/Applications/zoom.us.app" });
      report();
    },
    zoomStops: () => {
      using.delete("zoom");
      report();
    },
    vocifyStarts: () => {
      using.set("vocify", { bundleId: "com.vocify.app.helper", name: "Vocify Helper", pid: 502, path: "/Applications/Vocify.app" });
      report();
    },
    advance: async () => {
      await tick();
      await tick();
    },
  };
});

test("Mac CRM reader: a refused browser stops only itself, is retried silently, and comes back once allowed", async () => {
  let clock = 0;
  const consent: Record<string, "granted" | "denied"> = { "com.google.Chrome": "denied", "company.thebrowser.Browser": "granted" };
  let front = "com.google.Chrome";
  const answers: string[] = [];
  const exec = async (_file: string, args: string[]): Promise<string> => {
    const script = args[1] ?? "";
    if (script === FRONT_APP) return `${front}\n`;
    if (/ is running$/.test(script)) return "true\n";
    if (consent[front] === "denied") throw new Error("Not authorized to send Apple events. (-1743)");
    return "https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968\n";
  };
  let stored: Status = "denied";
  const reader = createMacCrmScreenReader({
    exec,
    access: () => stored,
    onDenied: () => void (stored = "denied", answers.push("denied")),
    onAllowed: () => void (stored = "authorized", answers.push("authorized")),
    now: () => clock,
  });
  // A stored refusal no longer switches every browser off.
  assert.equal(reader.isBrowser("com.google.Chrome"), true);
  assert.equal(await reader.read("com.google.Chrome"), null);
  // Another browser the rep allowed keeps working meanwhile.
  front = "company.thebrowser.Browser";
  assert.equal((await reader.read("company.thebrowser.Browser"))?.length, 1);
  // The refused one is not asked again before a minute (macOS would not ask anyway; it just saves the call).
  front = "com.google.Chrome";
  consent["com.google.Chrome"] = "granted";
  assert.equal(await reader.read("com.google.Chrome"), null);
  clock += 60_000;
  // Allowed in System Settings since: read again, and "allowed" is remembered.
  assert.equal((await reader.read("com.google.Chrome"))?.length, 1);
  assert.equal(stored, "authorized");
  assert.deepEqual(answers, ["denied", "authorized", "authorized"]);
});

test("Mac CRM reader: before the rep was asked once, no browser is read (reading is what makes macOS ask)", () => {
  const reader = createMacCrmScreenReader({ exec: async () => "", access: () => "never_requested" });
  assert.equal(reader.isBrowser("com.google.Chrome"), false);
});

test("Mac call detector: Chrome's helper holding the microphone is reported as Chrome, not as 'Google Chrome Helper'", async () => {
  const chromePath = "/Applications/Google Chrome.app";
  const helperPath = `${chromePath}/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper`;
  let helper: ReturnType<typeof fakeHelper> | null = null;
  let apps: { bundleId: string; name: string; pid: number; path: string }[] = [];
  const report = () => helper && !helper.killed && line(helper.stdout, { event: "mic", apps });
  const detector = createMacCallDetector({
    spawn: () => {
      helper = fakeHelper();
      setImmediate(report);
      return helper as unknown as HelperChild;
    },
    ownBundleId: "com.vocify.app",
  });
  const seen: (import("../src/platform/types.ts").DetectedCaller | null)[] = [];
  detector.start((caller) => seen.push(caller));
  await tick();

  apps = [{ bundleId: "com.google.Chrome.helper", name: "Google Chrome Helper", pid: 700, path: helperPath }];
  report();
  await tick();
  assert.deepEqual(seen.at(-1), { name: "Google Chrome", appId: "com.google.Chrome", path: chromePath, browser: true });

  // A renderer helper is the same app, so the same call: nothing new is reported.
  apps = [{ bundleId: "com.google.Chrome.helper.Renderer", name: "Google Chrome Helper (Renderer)", pid: 701, path: helperPath }];
  report();
  await tick();
  assert.equal(seen.filter((caller) => caller !== null).length, 1);
  assert.equal(seen.at(-1)?.name, "Google Chrome");

  // A named call app still wins over a browser, and a helper name never reaches the rep.
  apps = [
    { bundleId: "com.google.Chrome.helper", name: "Google Chrome Helper", pid: 700, path: helperPath },
    { bundleId: "us.zoom.xos", name: "zoom.us", pid: 501, path: "/Applications/zoom.us.app" },
  ];
  report();
  await tick();
  assert.equal(seen.at(-1)?.name, "Zoom");

  // Safari's web content process is Safari.
  apps = [{ bundleId: "com.apple.WebKit.WebContent", name: "Safari Web Content", pid: 800, path: "/System/Cryptexes/App/System/Applications/Safari.app/Contents/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent" }];
  report();
  await tick();
  assert.deepEqual([seen.at(-1)?.name, seen.at(-1)?.appId, seen.at(-1)?.browser], ["Safari", "com.apple.Safari", true]);
});
