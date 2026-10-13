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
import { phoneDialerContract } from "./contracts/phone-dialer.contract.ts";
import { createMacPhone } from "../src/platform/mac/phone.ts";
import { createAudioAccess } from "../src/platform/mac/audio-access.ts";

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

const macPhone = (hasFaceTime: boolean, fails = false) => {
  const runs: string[][] = [];
  const dialer = createMacPhone({
    open: async (args) => {
      runs.push(args);
      if (fails) throw new Error("open failed");
    },
    hasFaceTime: () => hasFaceTime,
  });
  return {
    dialer,
    runs,
    opened: () => runs.filter((args) => args.at(-1)?.startsWith("tel:")).map((args) => args.at(-1) ?? ""),
    setupOpened: () => runs.filter((args) => !args.at(-1)?.startsWith("tel:")).map((args) => args.join(" ")),
  };
};

phoneDialerContract("Mac", () => macPhone(true), () => macPhone(false));

test("Mac phone: the call opens in FaceTime by its bundle id, whatever app is the default for tel:", async () => {
  const h = macPhone(true);
  await h.dialer.dial("+34600111222");
  assert.deepEqual(h.runs, [["-b", "com.apple.FaceTime", "tel:+34600111222"]]);
});

test("Mac phone: FaceTime failing to open is reported, not thrown", async () => {
  assert.deepEqual(await macPhone(true, true).dialer.dial("+34600111222"), { ok: false, reason: "open_failed" });
});

test("Mac call detector: a call in FaceTime or from the iPhone, whose audio runs in the system's call service, is reported as FaceTime", async () => {
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
  // A daemon has no app: the helper names it by its bundle id and gives no path.
  apps = [{ bundleId: "com.apple.avconferenced", name: "com.apple.avconferenced", pid: 610, path: "" }];
  report();
  await tick();
  assert.deepEqual(seen.at(-1), { name: "FaceTime", appId: "com.apple.avconferenced", path: null, browser: false });
  detector.stop();
});

/** Call audio access on a Mac whose helper answers `audio-permission` with `answer`, and whose captures end in `start`. */
const audioAccess = (answer: string, start: { ok: boolean; reason?: string }, remembered: { started: boolean }) => {
  const access = createAudioAccess({
    spawn: () => {
      const helper = fakeHelper();
      setImmediate(() => {
        line(helper.stdout, { status: answer });
        helper.kill();
      });
      return helper as unknown as HelperChild;
    },
    capture: { start: async () => start, stop: async () => {}, onPcm: () => () => {}, onLost: () => () => {} },
    started: { get: () => remembered.started, set: () => void (remembered.started = true) },
  });
  return access;
};

test("Mac call audio: on a tap Mac (no way to read the permission) it is not asked until a capture has started once", async () => {
  const remembered = { started: false };
  const access = audioAccess("unknown", { ok: true }, remembered);
  await access.refresh();
  assert.equal(access.status(), "never_requested");
  await access.ask();
  assert.equal(access.status(), "authorized");
  assert.equal(remembered.started, true);
  const nextLaunch = audioAccess("unknown", { ok: true }, remembered);
  await nextLaunch.refresh();
  assert.equal(nextLaunch.status(), "authorized", "remembered across launches");
});

test("Mac call audio: the ScreenCaptureKit Mac's own check still decides, and a refused capture reads denied", async () => {
  const allowed = audioAccess("authorized", { ok: true }, { started: false });
  await allowed.refresh();
  assert.equal(allowed.status(), "authorized");
  const refused = audioAccess("never_requested", { ok: false, reason: "permission_denied" }, { started: false });
  await refused.systemAudio.start();
  assert.equal(refused.status(), "denied");
});

test("Mac phone: setting up opens FaceTime (its settings turn on Calls from iPhone)", async () => {
  const h = macPhone(true);
  await h.dialer.setup();
  assert.deepEqual(h.runs, [["-b", "com.apple.FaceTime"]]);
});

test("Mac phone: 'they can't hear me' opens FaceTime, which chooses its own microphone", async () => {
  const h = macPhone(true);
  await h.dialer.micSettings();
  assert.deepEqual(h.runs, [["-b", "com.apple.FaceTime"]]);
});

test("Mac capture with the microphone: the helper's stereo is split, microphone left and call right, sample for sample", async () => {
  const helper = fakeHelper();
  const spawned: Array<{ command: string; args?: string[] }> = [];
  const audio = createMacSystemAudio({
    spawn: (command, args) => {
      spawned.push({ command, args });
      return helper as unknown as HelperChild;
    },
    micAllowed: () => true,
  });
  const mic: number[] = [];
  const call: number[] = [];
  audio.onMicPcm((pcm) => mic.push(...new Int16Array(pcm)));
  audio.onPcm((pcm) => call.push(...new Int16Array(pcm)));
  const started = audio.start({ mic: true });
  line(helper.stderr, { event: "started" });
  line(helper.stderr, { event: "io", bytes: "2048,2048" });
  assert.deepEqual(await started, { ok: true, mic: true });
  assert.deepEqual(spawned, [{ command: "audio", args: ["--with-mic"] }]);
  // 100 ms of stereo in two pieces: left 1, 2, 3…; right -1, -2, -3…
  const stereo = new Int16Array(3200);
  for (let i = 0; i < 1600; i++) {
    stereo[2 * i] = i + 1;
    stereo[2 * i + 1] = -(i + 1);
  }
  const bytes = Buffer.from(stereo.buffer);
  helper.stdout.emit("data", bytes.subarray(0, 1001));
  helper.stdout.emit("data", bytes.subarray(1001));
  assert.equal(mic.length, 1600);
  assert.equal(call.length, 1600);
  assert.deepEqual([mic[0], mic[1599], call[0], call[1599]], [1, 1600, -1, -1600]);
});

test("Mac capture: the microphone only when the page asks and macOS allows it (else the helper would read silence)", async () => {
  for (const [ask, allowed] of [[false, true], [true, false]] as const) {
    const helper = fakeHelper();
    const spawned: Array<string[] | undefined> = [];
    const audio = createMacSystemAudio({
      spawn: (_command, args) => (spawned.push(args), helper as unknown as HelperChild),
      micAllowed: () => allowed,
    });
    const call: number[] = [];
    audio.onPcm((pcm) => call.push(new Int16Array(pcm).length));
    const started = audio.start({ mic: ask });
    line(helper.stderr, { event: "started" });
    assert.deepEqual(await started, { ok: true, mic: false });
    assert.deepEqual(spawned, [undefined]);
    helper.stdout.emit("data", Buffer.alloc(3200));
    assert.deepEqual(call, [1600], "mono call audio, as before");
  }
});

test("Mac capture: a helper whose device never runs with the microphone is restarted without it, so the call is heard", async () => {
  const helpers = [fakeHelper(), fakeHelper()];
  const spawned: Array<string[] | undefined> = [];
  const audio = createMacSystemAudio({
    spawn: (_command, args) => helpers[spawned.push(args) - 1] as unknown as HelperChild,
    micAllowed: () => true,
    micIoTimeoutMs: 20,
  });
  const call: number[] = [];
  audio.onPcm((pcm) => call.push(new Int16Array(pcm).length));
  const started = audio.start({ mic: true });
  line(helpers[0].stderr, { event: "started" });
  // No `io`: after the wait the first helper is stopped and a plain one started.
  await new Promise((resolve) => setTimeout(resolve, 40));
  line(helpers[1].stderr, { event: "started" });
  assert.deepEqual(await started, { ok: true, mic: false });
  assert.deepEqual(spawned, [["--with-mic"], undefined]);
  assert.equal(helpers[0].killed, true, "the first helper was stopped");
  helpers[1].stdout.emit("data", Buffer.alloc(3200));
  assert.deepEqual(call, [1600]);
});
