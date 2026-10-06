import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBridge, type BridgeDeps } from "../src/bridge.ts";
import { IslandController } from "../src/controller.ts";
import { Drafts } from "../src/drafts.ts";
import type { Loopback } from "../src/loopback/loopback.ts";
import { microphoneStatus, permissionSnapshot } from "../src/permissions.ts";
import { isAllowedBase, saasRequest } from "../src/saas.ts";
import { JsonSettings, type SettingsStore } from "../src/settings.ts";
import { comboFromEvent, defaultCombo, keyFor, ShortcutManager, type GlobalShortcutApi } from "../src/shortcut.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "vocify-test-"));

/* ---------- settings ---------- */

test("settings persist across instances and are written atomically", () => {
  const file = join(tmp(), "nested", "settings.json");
  const a = new JsonSettings(file);
  a.set("recorderReady", true);
  a.set("shortcut", { off: true });
  const b = new JsonSettings(file);
  assert.equal(b.get("recorderReady"), true);
  assert.deepEqual(b.get("shortcut"), { off: true });
  assert.equal(readdirSync(join(file, "..")).filter((n) => n.endsWith(".tmp")).length, 0, "no temporary file is left behind");
});

test("a missing, damaged or non-object settings file reads as nothing set", () => {
  const dir = tmp();
  assert.equal(new JsonSettings(join(dir, "none.json")).get("x"), undefined);
  writeFileSync(join(dir, "bad.json"), "{not json");
  assert.equal(new JsonSettings(join(dir, "bad.json")).get("x"), undefined);
  writeFileSync(join(dir, "list.json"), "[1,2]");
  assert.equal(new JsonSettings(join(dir, "list.json")).get("0"), undefined);
});

/* ---------- drafts ---------- */

test("drafts are saved, listed and removed, one file each", () => {
  const drafts = new Drafts(join(tmp(), "meetings"));
  assert.deepEqual(drafts.list(), [], "a missing folder lists nothing");
  assert.equal(drafts.save({ id: "a-1", text: "hello" }), true);
  assert.equal(drafts.save({ id: "b-2", text: "world" }), true);
  assert.deepEqual(drafts.list(), [{ id: "a-1", text: "hello" }, { id: "b-2", text: "world" }]);
  drafts.remove("a-1");
  assert.deepEqual(drafts.list(), [{ id: "b-2", text: "world" }]);
  drafts.remove("never-existed");
});

test("a draft can never name a file outside its folder", () => {
  const dir = tmp();
  const drafts = new Drafts(join(dir, "meetings"));
  for (const id of ["../escape", "a/b", "a\\b", "", "x".repeat(65), "with space", 42, null, undefined]) {
    assert.equal(drafts.save({ id }), false, `refuses id ${JSON.stringify(id)}`);
  }
  assert.equal(drafts.save("not an object"), false);
  assert.equal(drafts.save(null), false);
  drafts.remove("../escape");
  assert.deepEqual(readdirSync(dir), [], "nothing was written anywhere");
});

test("a damaged draft is skipped and the others are still recovered", () => {
  const dir = join(tmp(), "meetings");
  const drafts = new Drafts(dir);
  drafts.save({ id: "good", n: 1 });
  writeFileSync(join(dir, "bad.json"), "{broken");
  assert.deepEqual(drafts.list(), [{ id: "good", n: 1 }]);
});

/* ---------- API proxy ---------- */

test("only Vocify hosts, local development and railway.app subdomains are reachable", () => {
  for (const ok of ["https://api.getvocify.com/api/v1", "https://staging-api.getvocify.com", "http://localhost:8000/api", "http://127.0.0.1:8000", "https://app-x.up.railway.app", "https://railway.app"]) {
    assert.equal(isAllowedBase(ok), true, ok);
  }
  for (const bad of ["http://api.getvocify.com", "https://evil.com", "https://api.getvocify.com.evil.com", "https://railway.app.evil.com", "https://notrailway.app", "ftp://localhost", "javascript:alert(1)", "", "not a url"]) {
    assert.equal(isAllowedBase(bad), false, bad);
  }
});

test("a proxied request keeps method, headers and JSON body, and returns the data", async () => {
  const seen: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    seen.push({ url, init });
    return { status: 200, text: async () => JSON.stringify({ id: 7 }) };
  };
  const result = await saasRequest({ base: "https://api.getvocify.com/api/v1/", path: "memos", method: "post", headers: { Authorization: "Bearer t", Bad: 5 }, body: { a: 1 } }, fetchImpl);
  assert.deepEqual(result, { ok: true, status: 200, data: { id: 7 } });
  assert.equal(seen[0].url, "https://api.getvocify.com/api/v1/memos");
  assert.equal(seen[0].init.method, "POST");
  assert.deepEqual(seen[0].init.headers, { Authorization: "Bearer t", "Content-Type": "application/json" });
  assert.equal(seen[0].init.body, '{"a":1}');
});

test("a failing request reports the server's detail, and a refused host never reaches the network", async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return { status: 422, text: async () => JSON.stringify({ detail: "Bad memo" }) };
  };
  assert.deepEqual(await saasRequest({ base: "https://api.getvocify.com", path: "/x" }, fetchImpl), { ok: false, status: 422, data: { detail: "Bad memo" }, error: "Bad memo" });
  const refused = await saasRequest({ base: "https://evil.com", path: "/x" }, fetchImpl);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "API base is not a Vocify host");
  assert.equal(called, 1);
  const down = await saasRequest({ base: "https://api.getvocify.com", path: "/x" }, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(down, { ok: false, status: 0, data: {}, error: "offline" });
  const plain = await saasRequest({ base: "https://api.getvocify.com", path: "/x" }, async () => ({ status: 500, text: async () => "oops" }));
  assert.deepEqual(plain, { ok: false, status: 500, data: {}, error: "HTTP 500" });
});

/* ---------- permissions ---------- */

test("Electron's microphone status becomes the dashboard's three states", () => {
  assert.equal(microphoneStatus("granted"), "authorized");
  assert.equal(microphoneStatus("denied"), "denied");
  assert.equal(microphoneStatus("restricted"), "denied");
  assert.equal(microphoneStatus("not-determined"), "never_requested");
  assert.equal(microphoneStatus("unknown"), "never_requested");
});

test("the dashboard can be told another platform name than the real one, without changing what is possible", () => {
  assert.deepEqual(permissionSnapshot("win32", "granted", "darwin"), { platform: "darwin", microphone: "authorized", systemAudio: "authorized" });
});

test("on Windows call audio needs no permission; elsewhere it is unavailable", () => {
  assert.deepEqual(permissionSnapshot("win32", "granted"), { platform: "win32", microphone: "authorized", systemAudio: "authorized" });
  assert.deepEqual(permissionSnapshot("darwin", "denied"), { platform: "darwin", microphone: "denied", systemAudio: "authorized" }, "microphone-only elsewhere: call audio is reported ready so a recording can start");
});

/* ---------- shortcut ---------- */

test("the keys a shortcut may use read as the Swift app's do", () => {
  assert.deepEqual(keyFor("KeyR"), { accelerator: "R", label: "R" });
  assert.deepEqual(keyFor("Digit7"), { accelerator: "7", label: "7" });
  assert.deepEqual(keyFor("F12"), { accelerator: "F12", label: "F12" });
  assert.deepEqual(keyFor("Period"), { accelerator: ".", label: "." });
  assert.equal(keyFor("F20"), null);
  assert.equal(keyFor("Enter"), null);
  assert.equal(keyFor("ShiftLeft"), null);
});

test("combos: a plain key and the Windows key are refused, function keys may stand alone", () => {
  const press = (code: string, mods: Partial<Record<"meta" | "alt" | "ctrl" | "shift", boolean>> = {}) => ({ code, meta: false, alt: false, ctrl: false, shift: false, ...mods });
  assert.equal(comboFromEvent("win32", press("KeyR")), null, "a plain key would fire while typing");
  assert.equal(comboFromEvent("win32", press("KeyR", { shift: true })), null, "shift alone is not enough");
  assert.equal(comboFromEvent("win32", press("KeyR", { meta: true, ctrl: true })), null, "the Windows key cannot be registered reliably");
  assert.equal(comboFromEvent("win32", press("F9"))?.label, "F9");
  assert.equal(comboFromEvent("win32", press("KeyR", { ctrl: true, alt: true, shift: true }))?.label, "Ctrl+Alt+Shift+R");
  assert.equal(comboFromEvent("win32", press("KeyR", { ctrl: true, alt: true, shift: true }))?.accelerator, "Ctrl+Alt+Shift+R");
  assert.equal(comboFromEvent("darwin", press("KeyR", { meta: true, alt: true }))?.label, "⌥⌘R");
  assert.equal(comboFromEvent("darwin", press("KeyR", { meta: true, alt: true }))?.accelerator, "Alt+Command+R");
});

test("the default shortcut avoids the browser's reload and AltGr, and matches the Swift app on the Mac", () => {
  assert.equal(defaultCombo("win32").label, "Ctrl+Alt+Shift+R");
  assert.equal(defaultCombo("darwin").label, "⌥⌘R");
});

function shortcutSetup(taken: string[] = []) {
  const registered = new Map<string, () => void>();
  const api: GlobalShortcutApi = {
    register: (accelerator, callback) => {
      if (taken.includes(accelerator) || registered.has(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => void registered.delete(accelerator),
  };
  const store = new Map<string, unknown>();
  const settings: SettingsStore = { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) };
  let presses = 0;
  const manager = new ShortcutManager("win32", settings, api, () => void (presses += 1));
  return { manager, registered, store, presses: () => presses };
}

const R = { code: "KeyR", meta: false, alt: true, ctrl: true, shift: false };

test("the default shortcut is registered on first run and pressing it calls back", () => {
  const t = shortcutSetup();
  t.manager.activate();
  assert.deepEqual([...t.registered.keys()], ["Ctrl+Alt+Shift+R"]);
  t.registered.get("Ctrl+Alt+Shift+R")?.();
  assert.equal(t.presses(), 1);
  assert.deepEqual(t.manager.state(), { label: "Ctrl+Alt+Shift+R", defaultLabel: "Ctrl+Alt+Shift+R" });
});

test("a new shortcut replaces the old one and is remembered; a taken one keeps the old", () => {
  const t = shortcutSetup(["Ctrl+Alt+R"]);
  t.manager.activate();
  const taken = t.manager.set(R);
  assert.equal(taken.ok, false);
  assert.equal(taken.reason, "taken");
  assert.deepEqual([...t.registered.keys()], ["Ctrl+Alt+Shift+R"], "the previous shortcut still works");
  const ok = t.manager.set({ ...R, code: "KeyJ", shift: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.label, "Ctrl+Alt+Shift+J");
  assert.deepEqual([...t.registered.keys()], ["Ctrl+Alt+Shift+J"]);
  const invalid = t.manager.set({ code: "KeyJ", meta: false, alt: false, ctrl: false, shift: false });
  assert.equal(invalid.reason, "invalid");
  assert.deepEqual([...t.registered.keys()], ["Ctrl+Alt+Shift+J"], "an invalid one changes nothing");
});

test("a saved shortcut is restored on the next launch, and 'off' stays off", () => {
  const first = shortcutSetup();
  first.manager.activate();
  first.manager.set({ ...R, code: "KeyJ", shift: true });
  const second = new ShortcutManager("win32", { get: (k) => first.store.get(k), set: (k, v) => void first.store.set(k, v) }, { register: () => true, unregister: () => {} }, () => {});
  second.activate();
  assert.equal(second.state().label, "Ctrl+Alt+Shift+J");
  first.manager.clear();
  assert.equal(first.manager.state().label, null);
  assert.equal(first.registered.size, 0);
  const third = new ShortcutManager("win32", { get: (k) => first.store.get(k), set: () => {} }, { register: () => true, unregister: () => {} }, () => {});
  third.activate();
  assert.equal(third.state().label, null);
});

/* ---------- the bridge ---------- */

function bridgeSetup(options: { microphone?: string; loopbackStart?: { ok: boolean; reason?: string }; platform?: NodeJS.Platform; askMicrophone?: () => Promise<boolean>; testPermissions?: boolean; crmTabs?: () => string; askCrmTabs?: () => Promise<void> } = {}) {
  const emitted: { channel: string; payload: unknown }[] = [];
  const opened: string[] = [];
  const logs: string[] = [];
  let mainWindow = 0;
  const pcmListeners = new Set<(p: ArrayBuffer) => void>();
  const lostListeners = new Set<(r: string) => void>();
  let loopbackStops = 0;
  const loopback: Loopback = {
    start: async () => options.loopbackStart ?? { ok: true },
    stop: async () => void (loopbackStops += 1),
    onPcm: (cb) => (pcmListeners.add(cb), () => void pcmListeners.delete(cb)),
    onLost: (cb) => (lostListeners.add(cb), () => void lostListeners.delete(cb)),
  };
  const controller = new IslandController(
    {
      now: () => 0,
      after: () => () => {},
      emit: (channel, payload) => emitted.push({ channel, payload }),
      showMainWindow: () => void (mainWindow += 1),
      onState: () => {},
      onLevels: () => {},
      saveRecorderReady: () => {},
    },
    { notchWidth: 0, barHeight: 30, screenHeight: 900 },
    { recorderReady: true, material: "opaque", reduceMotion: false },
  );
  const store = new Map<string, unknown>();
  const shortcut = new ShortcutManager("win32", { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) }, { register: () => true, unregister: () => {} }, () => {});
  shortcut.activate();
  const deps: BridgeDeps = {
    readCrmPages: async () => ({ urls: ["https://app.hubspot.com/contacts/1/contact/2"], browsers: [{ name: "chrome", bundleId: "chrome", access: "granted" }] }),
    platform: options.platform ?? "win32",
    askMicrophone: options.askMicrophone,
    testPermissions: options.testPermissions,
    crmTabs: options.crmTabs,
    askCrmTabs: options.askCrmTabs,
    controller,
    loopback,
    drafts: new Drafts(join(tmp(), "meetings")),
    shortcut,
    emit: (channel, payload) => emitted.push({ channel, payload }),
    showMainWindow: () => void (mainWindow += 1),
    microphoneAccess: () => options.microphone ?? "granted",
    openExternal: (url) => opened.push(url),
    relaunch: () => {},
    fetch: async () => ({ status: 200, text: async () => "{}" }),
    log: (line) => logs.push(line),
  };
  return { call: createBridge(deps), emitted, opened, logs, controller, mainWindow: () => mainWindow, pcmListeners, lostListeners, loopbackStops: () => loopbackStops };
}

test("bridge: the permission test shows both permissions as not asked until the dashboard asks for each", async () => {
  const t = bridgeSetup({ microphone: "granted", testPermissions: true });
  assert.deepEqual(await t.call("permissions:status", {}), { platform: "win32", microphone: "never_requested", systemAudio: "never_requested", crmTabs: "authorized" });
  await t.call("permissions:request", { type: "microphone" });
  assert.deepEqual(await t.call("permissions:status", {}), { platform: "win32", microphone: "authorized", systemAudio: "never_requested", crmTabs: "authorized" });
  await t.call("permissions:request", { type: "systemAudio" });
  assert.deepEqual(await t.call("permissions:status", {}), { platform: "win32", microphone: "authorized", systemAudio: "authorized", crmTabs: "authorized" });
  assert.deepEqual(t.opened, ["ms-settings:privacy-microphone"], "the test shows the settings step once; Windows has no call-audio setting");
});

test("bridge: on a Mac the microphone is asked for with the system prompt once, and a refusal points to System Settings", async () => {
  let asked = 0;
  const fresh = bridgeSetup({ microphone: "not-determined", platform: "darwin", askMicrophone: async () => (asked += 1) > 0 });
  await fresh.call("permissions:request", { type: "microphone" });
  assert.equal(asked, 1);
  assert.deepEqual(fresh.opened, [], "the system's own prompt is shown, not Settings");
  const refused = bridgeSetup({ microphone: "denied", platform: "darwin", askMicrophone: async () => true });
  await refused.call("permissions:request", { type: "microphone" });
  assert.deepEqual(refused.opened, ["x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"]);
});

test("bridge: permissions report the global Windows microphone setting and open it on request", async () => {
  const t = bridgeSetup({ microphone: "denied" });
  assert.deepEqual(await t.call("permissions:status", {}), { platform: "win32", microphone: "denied", systemAudio: "authorized", crmTabs: "authorized" });
  await t.call("permissions:request", { type: "microphone" });
  assert.deepEqual(t.opened, ["ms-settings:privacy-microphone"]);
  await t.call("permissions:open", { type: "systemAudio" });
  assert.equal(t.opened.length, 1, "call audio has no setting to open");
  assert.deepEqual(await t.call("permissions:appInfo", {}), { name: "Vocify", bundleId: "com.vocify.app" });
  const granted = bridgeSetup({ microphone: "granted" });
  await granted.call("permissions:request", { type: "microphone" });
  assert.deepEqual(granted.opened, [], "nothing to open when access is already on");
});

test("bridge: only web and mail links open outside the app", async () => {
  const t = bridgeSetup();
  for (const url of ["https://hubspot.com/x", "http://localhost:8080", "mailto:a@b.com"]) await t.call("shell:open-external", { url });
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ms-settings:privacy-microphone", "data:text/html,x", 5, undefined]) await t.call("shell:open-external", { url });
  assert.deepEqual(t.opened, ["https://hubspot.com/x", "http://localhost:8080", "mailto:a@b.com"]);
});

test("bridge: 'show' brings the dashboard forward, any other command goes back to the page", async () => {
  const t = bridgeSetup();
  await t.call("shell:command", { name: "show" });
  await t.call("shell:command", { name: "listen" });
  assert.equal(t.mainWindow(), 1);
  assert.deepEqual(t.emitted.filter((e) => e.channel === "shell:command"), [{ channel: "shell:command", payload: "listen" }]);
});

test("bridge: the dashboard's state and overlay drive the island", async () => {
  const t = bridgeSetup();
  await t.call("shell:state", { state: { paused: true } });
  assert.equal(t.controller.state.paused, true);
  await t.call("overlay:show", {});
  assert.equal(t.controller.state.mode.kind, "recording");
  await t.call("overlay:hide", {});
  assert.equal(t.controller.state.mode.kind, "idle");
  await t.call("shell:state", { state: "not an object" });
});

test("bridge: drafts, saas, shortcut and the CRM stub answer in the dashboard's shapes", async () => {
  const t = bridgeSetup();
  assert.deepEqual(await t.call("drafts:save", { draft: { id: "d1" } }), { ok: true });
  assert.deepEqual(await t.call("drafts:save", { draft: { id: "../x" } }), { ok: false });
  assert.deepEqual(await t.call("drafts:list", {}), [{ id: "d1" }]);
  assert.deepEqual(await t.call("drafts:remove", { id: "d1" }), { ok: true });
  assert.deepEqual(await t.call("drafts:list", {}), []);
  assert.deepEqual(await t.call("saas:request", { payload: { base: "https://api.getvocify.com", path: "/x" } }), { ok: true, status: 200, data: {} });
  assert.deepEqual(await t.call("shortcut:get", {}), { label: "Ctrl+Alt+Shift+R", defaultLabel: "Ctrl+Alt+Shift+R" });
  assert.equal(((await t.call("shortcut:set", { code: "KeyR" })) as { reason: string }).reason, "invalid");
  assert.deepEqual(await t.call("shortcut:clear", {}), { label: null, defaultLabel: "Ctrl+Alt+Shift+R" });
  assert.deepEqual(await t.call("crm:pages", {}), { urls: ["https://app.hubspot.com/contacts/1/contact/2"], browsers: [{ name: "chrome", bundleId: "chrome", access: "granted" }] });
  assert.equal(await t.call("something:else", {}), null);
  await t.call("log:error", { kind: "error", path: "/x", text: "boom" });
  assert.deepEqual(t.logs, ["dashboard error at /x: boom"]);
});

test("bridge: call audio starts, its frames and its loss go to the page, and stopping releases it", async () => {
  const t = bridgeSetup();
  assert.deepEqual(await t.call("system-audio:start", {}), { ok: true, backend: "wasapi-loopback" });
  const frame = new ArrayBuffer(3200);
  for (const listener of t.pcmListeners) listener(frame);
  for (const listener of t.lostListeners) listener("track_ended");
  assert.deepEqual(t.emitted.map((e) => e.channel), ["system-audio:pcm", "system-audio:lost"]);
  assert.equal(t.emitted[0].payload, frame);
  assert.deepEqual(t.emitted[1].payload, { reason: "track_ended" });
  await t.call("system-audio:stop", {});
  assert.equal(t.pcmListeners.size + t.lostListeners.size, 0, "no listener is left behind");
});

test("bridge: a call-audio start that fails reports why and leaves nothing subscribed; where it cannot exist the recording carries on with the microphone", async () => {
  const mac = bridgeSetup({ loopbackStart: { ok: false, reason: "unsupported_platform" }, platform: "darwin" });
  assert.deepEqual(await mac.call("system-audio:start", {}), { ok: true, backend: "none" });
  assert.equal(mac.pcmListeners.size + mac.lostListeners.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const silent = mac.emitted.filter((e) => e.channel === "system-audio:pcm");
  assert.ok(silent.length >= 2, "the call side sends silence every 100 ms so its transcription stream stays open");
  assert.ok(silent.every((e) => e.payload instanceof ArrayBuffer && e.payload.byteLength === 3200 && new Uint8Array(e.payload).every((b) => b === 0)));
  await mac.call("system-audio:stop", {});
  const after = mac.emitted.length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(mac.emitted.length, after, "stopping ends the silence");
  const t = bridgeSetup({ loopbackStart: { ok: false, reason: "capture_failed:NotAllowedError" } });
  assert.deepEqual(await t.call("system-audio:start", {}), { ok: false, reason: "capture_failed:NotAllowedError" });
  assert.equal(t.pcmListeners.size + t.lostListeners.size, 0);
  await t.call("system-audio:start", {});
  assert.equal(t.pcmListeners.size, 0, "starting twice does not stack listeners");
});


test("bridge: reading the CRM tab needs no permission on Windows", async () => {
  const b = bridgeSetup({ platform: "win32" });
  assert.equal(((await b.call("permissions:status", {})) as { crmTabs?: string }).crmTabs, "authorized");
});

test("bridge: on a Mac the CRM tab permission is asked from first-run setup, and denied opens Automation settings", async () => {
  let status = "never_requested";
  let asked = 0;
  const b = bridgeSetup({
    platform: "darwin",
    crmTabs: () => status,
    askCrmTabs: async () => {
      asked += 1;
      status = "authorized";
    },
  });
  assert.equal(((await b.call("permissions:status", {})) as { crmTabs?: string }).crmTabs, "never_requested");
  const after = (await b.call("permissions:request", { type: "crmTabs" })) as { crmTabs?: string };
  assert.equal(asked, 1);
  assert.equal(after.crmTabs, "authorized");
  await b.call("crm:open-automation-settings", {});
  assert.deepEqual(b.opened, ["x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"]);
});

test("bridge: a build that cannot read browsers does not mention the CRM tab", async () => {
  const b = bridgeSetup({ platform: "darwin" });
  assert.equal("crmTabs" in ((await b.call("permissions:status", {})) as object), false);
});
