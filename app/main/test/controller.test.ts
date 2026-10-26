import assert from "node:assert/strict";
import { test } from "node:test";
import type { IslandState, Levels } from "../../island/src/types.ts";
import { backgroundLine, islandSize, showsConversation } from "../../island/src/geometry.ts";
import { IslandController, type Caller, type Effects } from "../src/controller.ts";

/** A clock and timer queue the tests move by hand, plus a record of everything the controller does outside itself. */
function setup(options: { recorderReady?: boolean; callSound?: boolean } = {}) {
  let now = 1_700_000_000_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const emitted: { channel: string; payload: unknown }[] = [];
  const log = { mainWindow: 0, saved: [] as boolean[], states: [] as IslandState[], levels: [] as Levels[], contactLookups: 0, sourceLookups: 0, soundWatch: null as (() => void) | null, soundStops: 0 };
  const effects: Effects = {
    now: () => now,
    after(ms, fn) {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    emit: (channel, payload) => emitted.push({ channel, payload }),
    showMainWindow: () => void (log.mainWindow += 1),
    onState: (state) => log.states.push(state),
    onLevels: (levels) => log.levels.push(levels),
    saveRecorderReady: (ready) => log.saved.push(ready),
    lookUpCallContact: () => void (log.contactLookups += 1),
    lookUpCallSource: () => void (log.sourceLookups += 1),
    ...(options.callSound ? { watchCallSound: (onSound: () => void) => void (log.soundWatch = onSound), stopCallSound: () => void (log.soundStops += 1) } : {}),
  };
  const controller = new IslandController(effects, { notchWidth: 185, barHeight: 32, screenHeight: 982 }, { recorderReady: options.recorderReady ?? true, material: "opaque", reduceMotion: false });
  const advance = (seconds: number) => {
    const target = now + seconds * 1000;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.live = false;
      due.fn();
    }
    now = target;
  };
  const commands = () => emitted.filter((e) => e.channel === "shell:command").map((e) => e.payload);
  const last = (channel: string) => emitted.filter((e) => e.channel === channel).at(-1)?.payload;
  return { controller, advance, emitted, log, commands, last, mode: () => controller.state.mode.kind };
}

const zoom: Caller = { name: "Zoom", appId: "zoom.exe" };

const postCall = (stage: string, extra: Record<string, unknown> = {}) => ({ stage, memoId: "m1", contactName: "Marta", crm: "HubSpot", ...extra });

/* ---------- idle and the countdown ---------- */

test("starts idle and closed", () => {
  const { controller } = setup();
  assert.equal(controller.state.mode.kind, "idle");
  assert.equal(controller.state.expanded, false);
});

test("clicking the idle island opens it and a countdown closes it after 5 s", () => {
  const t = setup();
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.countdown?.total, 5);
  t.advance(4.9);
  assert.equal(t.controller.state.expanded, true);
  t.advance(0.2);
  assert.equal(t.controller.state.expanded, false);
  assert.equal(t.controller.state.countdown, null);
});

test("the pointer holds the card open, and leaving lets it run out but never snaps it shut", () => {
  const t = setup();
  t.controller.act({ name: "toggle" });
  t.advance(4);
  t.controller.act({ name: "pointer", inside: true });
  t.advance(60);
  assert.equal(t.controller.state.expanded, true);
  assert.ok(Math.abs((t.controller.state.countdown?.remaining ?? 0) - 1) < 0.01);
  t.controller.act({ name: "pointer", inside: false });
  assert.ok((t.controller.state.countdown?.remaining ?? 0) >= 1.5, "at least 1.5 s after leaving");
  t.advance(1.4);
  assert.equal(t.controller.state.expanded, true);
  t.advance(0.2);
  assert.equal(t.controller.state.expanded, false);
});

/* ---------- recording ---------- */

test("signed out, Record opens Vocify to sign in and records nothing", () => {
  const t = setup({ recorderReady: false });
  t.controller.act({ name: "record" });
  assert.equal(t.log.mainWindow, 1);
  assert.equal(t.mode(), "idle");
  assert.deepEqual(t.commands(), []);
});

test("Record starts the dashboard's recorder, and the dashboard showing the overlay makes it recording", () => {
  const t = setup();
  t.controller.act({ name: "record" });
  assert.equal(t.mode(), "starting");
  assert.deepEqual(t.commands(), ["listen"]);
  assert.equal(t.log.sourceLookups, 1);
  t.controller.show();
  assert.equal(t.mode(), "recording");
  assert.equal(t.controller.state.expanded, false);
  t.advance(30);
  assert.equal(t.mode(), "recording", "the start timeout is cancelled");
});

test("a recorder that never starts returns the island to where it was and brings Vocify forward after 8 s", () => {
  const t = setup();
  t.controller.act({ name: "record" });
  t.advance(7.9);
  assert.equal(t.mode(), "starting");
  t.advance(0.2);
  assert.equal(t.mode(), "idle");
  assert.equal(t.log.mainWindow, 1);
});

test("while recording the island opens and closes without a countdown", () => {
  const t = setup();
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.countdown, null);
  t.advance(120);
  assert.equal(t.controller.state.expanded, true);
});

test("pause and resume are sent as the opposite of the dashboard's paused state", () => {
  const t = setup();
  t.controller.act({ name: "togglePause" });
  t.controller.applyShellState({ paused: true });
  t.controller.act({ name: "togglePause" });
  assert.deepEqual(t.commands(), ["pause", "resume"]);
});

/* ---------- stopping ---------- */

function recording() {
  const t = setup();
  t.controller.act({ name: "record" });
  t.controller.show();
  return t;
}

test("Stop pauses at once, says so, and ends the recording when 5 s pass without Resume", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  assert.equal(t.mode(), "stopped");
  assert.equal(t.controller.state.mode.kind === "stopped" && t.controller.state.mode.title, "Recording stopped");
  assert.equal(t.controller.state.expanded, true);
  assert.deepEqual(t.commands().slice(-1), ["pause"]);
  t.advance(4.9);
  assert.equal(t.mode(), "stopped");
  t.advance(0.2);
  assert.equal(t.mode(), "finishing", "the island waits, on a spinner, for the memo");
  assert.deepEqual(t.commands().slice(-2), ["pause", "stop"]);
});

test("Finish ends the stopped recording at once, without waiting for the line to run out", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(1);
  t.controller.act({ name: "finish" });
  assert.equal(t.mode(), "finishing");
  assert.deepEqual(t.commands().slice(-2), ["pause", "stop"]);
  t.controller.act({ name: "finish" });
  assert.deepEqual(t.commands().slice(-2), ["pause", "stop"], "a second press does nothing");
});

test("Discard throws the stopped recording away: the dashboard is told to drop it and the island goes to rest", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(1);
  t.controller.act({ name: "discard" });
  assert.notEqual(t.mode(), "finishing");
  assert.notEqual(t.mode(), "stopped");
  assert.deepEqual(t.commands().slice(-2), ["pause", "discard"]);
  t.advance(10);
  assert.deepEqual(t.commands().slice(-2), ["pause", "discard"], "the line running out does not also write the memo");
  t.controller.act({ name: "discard" });
  assert.deepEqual(t.commands().slice(-2), ["pause", "discard"], "a second press does nothing");
});

/* ---------- the finished calls the dashboard is still on ---------- */

test("a dashboard that reports its finished calls leaves the island free at once: no spinner, the next recording starts, the last card does not open again", () => {
  const t = recording();
  t.controller.applyShellState({ background: [], postCall: postCall("done") });
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  assert.equal(t.mode(), "idle", "nothing to wait for");
  assert.equal(t.controller.state.expanded, false, "the last card stays closed");
  t.controller.applyShellState({ postCall: null, background: [{ id: "d1", name: "Marta", state: "working" }] });
  t.controller.act({ name: "record" });
  assert.equal(t.mode(), "starting");
  assert.deepEqual(t.commands().slice(-1), ["listen"]);
  t.controller.show();
  assert.equal(t.mode(), "recording");
  assert.deepEqual(t.controller.state.background, [{ id: "d1", name: "Marta", state: "working" }], "the badge reads it while the next call runs");
});

test("a dashboard that does not report them keeps today's wait on a spinner", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  assert.equal(t.mode(), "finishing");
  assert.equal(t.controller.state.background ?? null, null);
});

test("a finished call's card is asked for by the rep and arrives when the island is at rest; a card that arrives during a recording waits", () => {
  const t = setup();
  t.controller.applyShellState({ background: [{ id: "d1", name: "Marta", state: "needs" }] });
  t.controller.act({ name: "postCall", type: "openJob", details: { id: "d1" } });
  assert.deepEqual(t.last("postcall:action"), { id: "d1", type: "openJob" });
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
  assert.equal(t.controller.state.expanded, true);
  const busy = recording();
  busy.controller.applyShellState({ background: [{ id: "d1", name: "Marta", state: "needs" }], postCall: postCall("ready") });
  assert.equal(busy.mode(), "recording", "a call in progress is not interrupted");
});

test("the line for the finished calls adds its height to a short open island only", () => {
  const t = setup();
  t.controller.act({ name: "toggle" });
  const base = islandSize(t.controller.state.geometry, "idle", true);
  assert.equal(backgroundLine(t.controller.state), 0);
  t.controller.applyShellState({ background: [{ id: "d1", name: null, state: "working" }] });
  assert.equal(backgroundLine(t.controller.state), 32);
  assert.equal(base.height + backgroundLine(t.controller.state), 120);
  assert.equal(backgroundLine({ mode: { kind: "recording" }, background: [{ id: "d1", name: null, state: "working" }] }), 0, "a recording shows a badge instead");
  assert.equal(backgroundLine({ mode: { kind: "postCall" }, background: [{ id: "d1", name: null, state: "needs" }] }), 0, "a card sizes itself");
});

test("while finishing the island ignores the dashboard hiding it, the shortcut and a call app, and shows the memo when a new one arrives", () => {
  const t = recording();
  t.controller.applyShellState({ postCall: postCall("done") });
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.controller.hide();
  assert.equal(t.mode(), "finishing", "the dashboard hides its overlay as it stops");
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "finishing");
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "finishing");
  t.controller.applyShellState({ postCall: postCall("writing") });
  assert.equal(t.mode(), "finishing", "the card on show when the recording ended is the last call's, not this one's");
  t.controller.applyShellState({ postCall: { ...postCall("writing"), memoId: "m2" } });
  assert.equal(t.mode(), "postCall");
});

test("the dashboard's account of the ended recording: sending shows a line, a failure opens the island and stays until closed", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.controller.applyShellState({ finish: { step: "stopping" } });
  assert.equal(t.controller.state.finish?.step, "stopping");
  assert.equal(t.controller.state.expanded, false, "progress does not open it");
  t.controller.applyShellState({ finish: { step: "bogus" } });
  assert.equal(t.controller.state.finish, null, "an unknown step is dropped");
  t.controller.applyShellState({ finish: { step: "failed", message: "No audio was heard" } });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.finish?.message, "No audio was heard");
  t.advance(120);
  assert.equal(t.mode(), "finishing", "a failure is not given up on");
  t.controller.act({ name: "toggle" });
  assert.equal(t.mode(), "idle", "closing the failure ends the wait");
});

test("the failure card's Dismiss closes it and frees the island for the next call", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.controller.applyShellState({ finish: { step: "failed", message: "Couldn't send the meeting. It's saved on this computer." } });
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "dismissFinish" });
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.expanded, false);
  t.controller.callChanged(null);
  t.controller.callChanged(zoom);
  t.advance(1);
  assert.equal(t.mode(), "call", "the next call is offered");
});

test("a recording whose memo never comes stops waiting after 30 s", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.advance(29);
  assert.equal(t.mode(), "finishing");
  t.advance(2);
  assert.equal(t.mode(), "idle");
});

test("clicking the finishing island peeks at where the call is and closes again", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, false);
  assert.equal(t.mode(), "finishing");
});

test("Resume inside the grace carries on the same recording", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(2);
  t.controller.act({ name: "resume" });
  assert.equal(t.mode(), "recording");
  assert.deepEqual(t.commands().slice(-2), ["pause", "resume"]);
  t.advance(30);
  assert.equal(t.mode(), "recording", "the grace timer is gone");
});

test("stopping while already paused sends no extra pause or resume", () => {
  const t = recording();
  t.controller.applyShellState({ paused: true });
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "resume" });
  assert.deepEqual(t.commands(), ["listen"]);
});

test("the pointer cannot hold the stop grace open", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "pointer", inside: true });
  t.advance(5.1);
  assert.equal(t.mode(), "finishing");
});

test("the record shortcut records, stops, resumes, and starts a new call from an old card", () => {
  const t = setup();
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "starting");
  t.controller.show();
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "stopped");
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "recording");
  t.controller.act({ name: "stop" });
  t.advance(6);
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "starting");
});

/* ---------- detected calls ---------- */

test("a detected call drops the island down once to be noticed, then it settles", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "call");
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.countdown?.total, 8);
  assert.equal(t.log.contactLookups, 1);
  t.advance(8.1);
  assert.equal(t.controller.state.expanded, false);
  assert.equal(t.mode(), "call");
});

test("the same call reported again does not drop the island again", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.advance(9);
  t.controller.callChanged({ ...zoom });
  assert.equal(t.controller.state.expanded, false);
  assert.equal(t.log.contactLookups, 1);
});

test("the call ending without a recording tells the dashboard and returns to idle", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.callChanged(null);
  assert.equal(t.mode(), "idle");
  assert.equal(t.last("call:ended") !== undefined, true);
});

test("skipping a call hides the offer and it is not offered again until the mic goes quiet", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "dismissCall" });
  assert.equal(t.mode(), "idle");
  t.controller.callChanged({ ...zoom });
  assert.equal(t.mode(), "idle");
  t.controller.callChanged(null);
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "call");
});

test("a call recorded and hung up is over: the same app holding the mic again soon after is offered as a new call", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.callChanged(null);
  t.advance(3.1);
  assert.equal(t.mode(), "stopped");
  t.controller.hide();
  t.advance(6);
  t.controller.callChanged({ ...zoom });
  assert.equal(t.mode(), "call");
});

test("a call stopped by hand while the app still holds the mic is not offered again at once", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.hide();
  t.controller.callChanged({ ...zoom });
  assert.equal(t.mode(), "idle");
});

test("the call app letting go of the mic while the recording is still starting still ends it", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.callChanged(null);
  t.controller.show();
  t.advance(3.1);
  assert.equal(t.mode(), "stopped");
});

test("no offer while the dashboard is already recording", () => {
  const t = setup();
  t.controller.applyShellState({ listening: true });
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "idle");
});

test("recording a detected call: the call app letting go of the mic for 3 s stops it as a hang-up", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.callChanged(null);
  t.advance(2.9);
  assert.equal(t.mode(), "recording");
  t.advance(0.2);
  assert.equal(t.mode(), "stopped", "a hang-up waits for Resume like a stop, in case the call only dropped");
  assert.equal(t.controller.state.mode.kind === "stopped" && t.controller.state.mode.title, "Call ended");
  assert.deepEqual(t.commands().slice(-1), ["pause"]);
  assert.ok(!t.emitted.some((e) => e.channel === "call:ended"), "the call is reported over only once it finishes");
  t.advance(5.1);
  assert.equal(t.mode(), "finishing");
  assert.deepEqual(t.commands().slice(-1), ["stop"]);
  assert.ok(t.emitted.some((e) => e.channel === "call:ended"));
});

test("a mic dropout shorter than 3 s (a device switch) is not a hang-up", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.callChanged(null);
  t.advance(1.5);
  t.controller.callChanged(zoom);
  t.advance(10);
  assert.equal(t.mode(), "recording");
});

test("the app just recorded is not offered again for 120 s, other apps are", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.act({ name: "stop" });
  t.advance(6);
  t.advance(31); // no memo ever comes: back to rest
  t.controller.applyShellState({ listening: false });
  t.controller.callChanged(null);
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "idle", "a dialer grabbing the mic again after the call is not a new call");
  t.controller.callChanged({ name: "Teams", appId: "teams.exe" });
  assert.equal(t.mode(), "call");
  t.controller.callChanged(null);
  t.advance(121);
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "call");
});

/* ---------- the dashboard's state ---------- */

test("losing the call's audio opens a closed recording island once", () => {
  const t = recording();
  t.controller.applyShellState({ callAudioLost: true });
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "toggle" });
  t.controller.applyShellState({ callAudioLost: false });
  t.controller.applyShellState({ callAudioLost: true });
  assert.equal(t.controller.state.expanded, true, "it opens again for a new loss");
  t.controller.act({ name: "toggle" });
  t.controller.applyShellState({ callAudioLost: true });
  assert.equal(t.controller.state.expanded, false, "no change, no reopening");
});

test("a silent mic opens a closed recording island, and clears", () => {
  const t = recording();
  t.controller.applyShellState({ micSilent: true });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.micSilent, true);
  t.controller.act({ name: "toggle" });
  t.controller.applyShellState({ micSilent: false });
  assert.equal(t.controller.state.micSilent, false);
  assert.equal(t.controller.state.expanded, false, "the mic coming back does not open it");
});

test("recorderReady is remembered across launches", () => {
  const t = setup({ recorderReady: false });
  t.controller.applyShellState({ recorderReady: true });
  t.controller.applyShellState({ recorderReady: true });
  assert.deepEqual(t.log.saved, [true]);
  assert.equal(t.controller.state.recorderReady, true);
});

test("the live help switch sends the opposite command", () => {
  const t = recording();
  t.controller.applyShellState({ liveHelp: true });
  t.controller.act({ name: "toggleLiveHelp" });
  t.controller.applyShellState({ liveHelp: false });
  t.controller.act({ name: "toggleLiveHelp" });
  assert.deepEqual(t.commands().slice(-2), ["assist-off", "assist-on"]);
});

test("the call type menu follows Vocify's proposal, and a pick is final and sent to the dashboard", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { selected: "discovery", proposed: true, options: [{ key: "discovery", label: "Discovery call" }, { key: "demo", label: "Demo" }] } });
  let menu = t.controller.state.typeMenu;
  assert.equal(menu?.title, "Discovery call");
  assert.equal(menu?.proposed, true);
  assert.equal(menu?.rows.find((r) => r.checked)?.key, "discovery");
  t.controller.act({ name: "pickCallType", key: "demo" });
  menu = t.controller.state.typeMenu;
  assert.equal(menu?.title, "Demo");
  assert.equal(menu?.proposed, false);
  assert.equal(menu?.rows.find((r) => r.checked)?.key, "demo");
  assert.deepEqual(t.last("call:type"), { key: "demo" });
});

test("the mics the dashboard reports reach the island, and a picked one is sent back and ends the notice", () => {
  const t = recording();
  t.controller.applyShellState({
    mic: {
      devices: [{ id: "mac", label: "MacBook Pro Microphone" }, { id: "", label: "no id" }, { id: "x", label: " " }],
      defaultLabel: "iPhone Microphone",
      chosen: { id: "airpods", label: "AirPods Pro" },
      inUse: "iPhone Microphone",
      notice: true,
    },
  });
  // A mic without an id or a name is dropped, never shown.
  assert.deepEqual(t.controller.state.mic, {
    devices: [{ id: "mac", label: "MacBook Pro Microphone" }],
    defaultLabel: "iPhone Microphone",
    chosen: { id: "airpods", label: "AirPods Pro" },
    inUse: "iPhone Microphone",
    notice: true,
  });
  t.controller.act({ name: "pickMic", mic: { id: "mac", label: "MacBook Pro Microphone" } });
  assert.deepEqual(t.last("mic:choose"), { id: "mac", label: "MacBook Pro Microphone" });
  assert.equal(t.controller.state.mic?.notice, false);
  assert.deepEqual(t.controller.state.mic?.chosen, { id: "mac", label: "MacBook Pro Microphone" });
  t.controller.act({ name: "pickMic", mic: null });
  assert.equal(t.last("mic:choose"), null);
});

test("the line that names an unusual mic folds after a while open, and stays folded for that recording", () => {
  const t = openRecording();
  const mic = { devices: [{ id: "mac", label: "MacBook Pro Microphone" }], defaultLabel: "iPhone Microphone", chosen: null, inUse: "iPhone Microphone", notice: true };
  t.controller.applyShellState({ mic });
  assert.equal(t.controller.state.mic?.notice, true);
  t.advance(7.9);
  assert.equal(t.controller.state.mic?.notice, true);
  t.advance(0.2);
  assert.equal(t.controller.state.mic?.notice, false);
  // The dashboard reporting the mics again (one plugged in) does not bring it back.
  t.controller.applyShellState({ mic: { ...mic, devices: [...mic.devices, { id: "usb", label: "USB Mic" }] } });
  assert.equal(t.controller.state.mic?.notice, false);
  // The next recording on that mic says so again.
  t.controller.applyShellState({ mic: { ...mic, inUse: null, notice: false } });
  t.controller.applyShellState({ mic });
  assert.equal(t.controller.state.mic?.notice, true);
});

test("tapping Vocify's ticked proposal confirms it as the rep's own", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { selected: "discovery", proposed: true, options: [{ key: "discovery", label: "Discovery call" }] } });
  t.controller.act({ name: "pickCallType", key: "discovery" });
  assert.equal(t.controller.state.typeMenu?.proposed, false);
  assert.deepEqual(t.last("call:type"), { key: "discovery" });
});

const NOTE_OPTIONS = [{ key: "discovery", label: "Discovery" }, { key: "closing", label: "Demo y cierre" }, { key: "proposal", label: "Propuesta" }];
/** A recording with the island open: the type's line is only timed while it can be seen. */
function openRecording() {
  const t = recording();
  t.controller.act({ name: "toggle" });
  return t;
}
const typeFrom = (selected: string | null, proposed: boolean) => ({ liveType: { selected, proposed, options: NOTE_OPTIONS } });

test("a type Vocify sets grows the tag into a proposal for 4 s, then folds back", () => {
  const t = openRecording();
  t.controller.applyShellState(typeFrom("closing", true));
  assert.deepEqual(t.controller.state.typeMenu?.note && [t.controller.state.typeMenu.note.kind, t.controller.state.typeMenu.note.label], ["propose", "Demo y cierre"]);
  t.advance(3.9);
  assert.ok(t.controller.state.typeMenu?.note);
  t.advance(0.2);
  assert.equal(t.controller.state.typeMenu?.note, null);
  assert.equal(t.controller.state.typeMenu?.title, "Demo y cierre");
});

test("a type Vocify sets while the island is closed is announced once it is opened, for 4 s", () => {
  const t = recording();
  assert.equal(t.controller.state.expanded, false);
  t.controller.applyShellState(typeFrom("closing", true));
  t.advance(30);
  assert.equal(t.controller.state.typeMenu?.note?.kind, "propose");
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, true);
  t.advance(3.9);
  assert.ok(t.controller.state.typeMenu?.note);
  t.advance(0.2);
  assert.equal(t.controller.state.typeMenu?.note, null);
});

test("a later change reads as a change, and Undo restores the type before as the rep's own, for good", () => {
  const t = openRecording();
  t.controller.applyShellState(typeFrom("discovery", true));
  t.advance(5);
  t.controller.applyShellState(typeFrom("closing", true));
  assert.equal(t.controller.state.typeMenu?.note?.kind, "change");
  t.controller.act({ name: "undoCallType" });
  assert.equal(t.controller.state.typeMenu?.title, "Discovery");
  assert.equal(t.controller.state.typeMenu?.note, null);
  assert.equal(t.controller.state.typeMenu?.proposed, false);
  assert.deepEqual(t.last("call:type"), { key: "discovery" });
  t.controller.applyShellState(typeFrom("proposal", true));
  assert.equal(t.controller.state.typeMenu?.note, null);
});

test("Undo does nothing on a first proposal", () => {
  const t = openRecording();
  t.controller.applyShellState(typeFrom("discovery", true));
  t.controller.act({ name: "undoCallType" });
  assert.equal(t.last("call:type"), undefined);
  assert.equal(t.controller.state.typeMenu?.note?.kind, "propose");
});

test("a pick, even of the type already shown, ends the note and nothing is announced after it", () => {
  const t = openRecording();
  t.controller.applyShellState(typeFrom("discovery", true));
  t.controller.act({ name: "pickCallType", key: "discovery" });
  assert.equal(t.controller.state.typeMenu?.note, null);
  t.controller.applyShellState(typeFrom("closing", true));
  assert.equal(t.controller.state.typeMenu?.note, null);
  t.advance(10);
  assert.equal(t.controller.state.typeMenu?.note, null);
});

test("a new call announces again, and the language comes from the computer unless the dashboard says", () => {
  const t = openRecording();
  assert.equal(t.controller.state.language, "en");
  t.controller.applyShellState({ language: "es" });
  assert.equal(t.controller.state.language, "es");
  t.controller.applyShellState(typeFrom("discovery", true));
  t.controller.act({ name: "pickCallType", key: "closing" });
  t.controller.applyShellState({ liveType: null });
  t.controller.applyShellState(typeFrom("discovery", true));
  assert.equal(t.controller.state.typeMenu?.note?.kind, "propose");
});

const CHANNEL_TYPES = {
  selected: "cold",
  proposed: true,
  options: [{ key: "cold", label: "Llamada en frío" }, { key: "internal", label: "Interna" }],
  channel: { selected: "call", fixed: false, options: [{ key: "call", label: "Llamada" }, { key: "meeting", label: "Reunión" }] },
};

test("types by channel: the menu also says the channel, and a switch is shown at once and sent to the dashboard", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: CHANNEL_TYPES });
  let channel = t.controller.state.typeMenu?.channel;
  assert.equal(channel?.title, "Llamada");
  assert.deepEqual(channel?.rows.map((row) => [row.key, row.checked]), [["call", true], ["meeting", false]]);
  t.controller.act({ name: "pickChannel", kind: "meeting" });
  channel = t.controller.state.typeMenu?.channel;
  assert.equal(channel?.title, "Reunión");
  assert.deepEqual(t.last("call:channel"), { kind: "meeting" });
});

test("types by channel: a fixed channel (a Vocify call) is not offered and never switches", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { ...CHANNEL_TYPES, channel: { ...CHANNEL_TYPES.channel, fixed: true } } });
  assert.equal(t.controller.state.typeMenu?.channel, null);
  t.controller.act({ name: "pickChannel", kind: "meeting" });
  assert.equal(t.last("call:channel"), undefined);
});

test("without a channel (an older dashboard) the menu is the type alone, as before", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { selected: "demo", proposed: false, options: [{ key: "demo", label: "Demo" }] } });
  assert.equal(t.controller.state.typeMenu?.channel, null);
  t.controller.applyShellState({ liveType: { ...CHANNEL_TYPES, channel: { selected: "visit", fixed: false, options: [] } } });
  assert.equal(t.controller.state.typeMenu?.channel, null);
});

test("a live type with no options is no menu, and clearing it removes the menu", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { selected: null, proposed: false, options: [] } });
  assert.equal(t.controller.state.typeMenu, null);
  t.controller.applyShellState({ liveType: { selected: "demo", proposed: false, options: [{ key: "demo", label: "Demo" }] } });
  assert.ok(t.controller.state.typeMenu);
  t.controller.applyShellState({ liveType: null });
  assert.equal(t.controller.state.typeMenu, null);
});

test("live help: a draft is a loading state, an answer retired becomes 'earlier', a draft retired leaves nothing", () => {
  const t = recording();
  t.controller.applyShellState({ assist: { stage: "draft", bridge: "Fair point." } });
  assert.equal(t.controller.state.assist?.drafting, true);
  t.controller.applyShellState({ assist: { label: "Price", sayThis: "Most teams recover it.", bridge: "Fair point." } });
  assert.equal(t.controller.state.assist?.drafting, false);
  t.controller.applyShellState({ assist: null });
  assert.equal(t.controller.state.assist, null);
  assert.equal(t.controller.state.lastHelp?.sayThis, "Most teams recover it.");
  t.controller.applyShellState({ assist: { stage: "draft", bridge: "Next." } });
  t.controller.applyShellState({ assist: null });
  assert.equal(t.controller.state.lastHelp?.sayThis, "Most teams recover it.", "a draft is never kept as help");
  t.controller.applyShellState({ assist: { label: "", sayThis: "", bridge: "" } });
  assert.equal(t.controller.state.assist, null, "nothing to show is no card");
});

test("the dashboard's overlay becomes the transcript, unless a native recorder draws it", () => {
  const t = recording();
  t.controller.applyShellState({ overlay: { turns: [{ key: "a", you: true, text: "Hello", pending: "wor" }, { you: false, label: "Marta", text: "Hi" }] } });
  assert.deepEqual(t.controller.state.turns, [
    { id: "a", you: true, label: null, text: "Hello", pending: "wor" },
    { id: "row-1", you: false, label: "Marta", text: "Hi", pending: "" },
  ]);
  t.controller.nativeTranscript = true;
  t.controller.applyShellState({ overlay: { turns: [] } });
  assert.equal(t.controller.state.turns.length, 2);
});

test("the contact name is trimmed, and blank means none", () => {
  const t = setup();
  t.controller.applyShellState({ callContact: { name: "  Marta Ruiz  " } });
  assert.equal(t.controller.state.callContact, "Marta Ruiz");
  t.controller.applyShellState({ callContact: { name: "   " } });
  assert.equal(t.controller.state.callContact, null);
  t.controller.applyShellState({ callContact: null });
  assert.equal(t.controller.state.callContact, null);
});

test("the clock needs a start time; paused time is kept", () => {
  const t = setup();
  t.controller.applyShellState({ clock: { pausedMs: 5 } });
  assert.equal(t.controller.state.clock, null);
  t.controller.applyShellState({ clock: { startedAt: 1000, pausedMs: 250, pausedAt: 4000 } });
  assert.deepEqual(t.controller.state.clock, { startedAt: 1000, pausedMs: 250, pausedAt: 4000 });
});

test("levels go on their own channel, never a full state, and the wave side holds through silence and near ties", () => {
  const t = setup();
  const before = t.log.states.length;
  t.controller.applyShellState({ levels: { you: 0.5, them: 0 } });
  assert.equal(t.log.states.length, before, "no full state for a level");
  assert.equal(t.log.levels.at(-1)?.side, "you");
  t.controller.applyShellState({ levels: { you: 0.5, them: 0.52 } });
  assert.equal(t.log.levels.at(-1)?.side, "you", "a near tie keeps the colour");
  t.controller.applyShellState({ levels: { you: 0, them: 0 } });
  assert.equal(t.log.levels.at(-1)?.side, "you", "silence keeps the colour");
  t.controller.applyShellState({ levels: { you: 0, them: 0.6 } });
  assert.equal(t.log.levels.at(-1)?.side, "them");
});

test("a state with nothing new makes no render", () => {
  const t = setup();
  t.controller.applyShellState({ paused: false, recorderReady: true, liveHelp: undefined });
  const before = t.log.states.length;
  t.controller.applyShellState({ paused: false, recorderReady: true });
  assert.equal(t.log.states.length, before);
});

/* ---------- after the call ---------- */

test("the call's update waits for the island to come back to rest, then opens with a 14 s countdown", () => {
  const t = recording();
  t.controller.applyShellState({ postCall: { ...postCall("writing"), memoId: "m0" } });
  assert.equal(t.mode(), "recording", "not shown while recording");
  t.controller.act({ name: "stop" });
  t.advance(6);
  assert.equal(t.mode(), "finishing", "the card on show is the last call's: wait for this one");
  t.controller.applyShellState({ postCall: postCall("writing") });
  assert.equal(t.mode(), "postCall");
  assert.equal(t.controller.state.expanded, false, "writing stays closed: the spinner says enough");
  t.controller.applyShellState({ postCall: postCall("ready", { canApprove: true }) });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.countdown?.total, 14);
  t.advance(14.1);
  assert.equal(t.controller.state.expanded, false);
});

test("applying stops the countdown so the card stays until it is done", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(6);
  t.controller.applyShellState({ postCall: postCall("ready") });
  t.controller.applyShellState({ postCall: postCall("applying") });
  assert.equal(t.controller.state.countdown, null);
  t.advance(60);
  assert.equal(t.controller.state.expanded, true);
});

test("a finished update with nothing pending dismisses itself after 3 s", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(6);
  t.controller.applyShellState({ postCall: postCall("applying") });
  t.controller.applyShellState({ postCall: postCall("done", { applied: 4 }) });
  assert.equal(t.controller.state.countdown?.total, 3);
  t.advance(3.1);
  assert.deepEqual(t.last("postcall:action"), { type: "dismiss" });
});

test("Done closes the after-call card even when the dashboard never answers (signed out, reloaded or closed)", () => {
  const t = setup();
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "postCall", type: "dismiss" });
  assert.deepEqual(t.last("postcall:action"), { type: "dismiss" }, "the dashboard is still told");
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.expanded, false);
  assert.equal(t.controller.state.postCall, null);
  // The dashboard's own clearing, if it comes, changes nothing; a new call's card still shows.
  t.controller.applyShellState({ postCall: null });
  assert.equal(t.mode(), "idle");
  t.controller.applyShellState({ postCall: { ...postCall("ready"), memoId: "m2" } });
  assert.equal(t.mode(), "postCall");
});

test("the dashboard clearing the call's update returns the island to idle", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.advance(6);
  t.controller.applyShellState({ postCall: postCall("ready") });
  t.controller.applyShellState({ postCall: null });
  assert.equal(t.mode(), "idle");
});

test("choices in the card go to the dashboard unchanged; review, email and notes also bring Vocify forward", () => {
  const t = setup();
  t.controller.act({ name: "postCall", type: "approve", details: { omit: ["deal:amount"], edits: {} } });
  assert.deepEqual(t.last("postcall:action"), { omit: ["deal:amount"], edits: {}, type: "approve" });
  assert.equal(t.log.mainWindow, 0);
  // "openNotes" is what the card's Notes tab sends ("notes" was the Swift card's name for it).
  for (const type of ["review", "openEmail", "openNotes"]) t.controller.act({ name: "postCall", type });
  assert.equal(t.log.mainWindow, 3);
  t.controller.act({ name: "postCall", type: "undo" });
  assert.equal(t.log.mainWindow, 3);
});

test("the updated record opens in the browser, and only a web link the dashboard gave", () => {
  const t = setup();
  const opened: string[] = [];
  (t.controller as unknown as { effects: Effects }).effects.openExternal = (url) => void opened.push(url);
  t.controller.applyShellState({ postCall: postCall("done", { crmUrl: "javascript:alert(1)" }) });
  t.controller.act({ name: "postCall", type: "openCrm" });
  assert.deepEqual(opened, []);
  t.controller.applyShellState({ postCall: postCall("done", { crmUrl: "https://app.hubspot.com/contacts/1/record/0-1/42" }) });
  t.controller.act({ name: "postCall", type: "openCrm" });
  assert.deepEqual(opened, ["https://app.hubspot.com/contacts/1/record/0-1/42"]);
  assert.equal(t.log.mainWindow, 0);
});

test("malformed post-call data is dropped, not guessed", () => {
  const t = setup();
  t.controller.applyShellState({ postCall: { stage: "banana", memoId: "m" } });
  assert.equal(t.controller.state.postCall, null);
  t.controller.applyShellState({ postCall: { stage: "ready" } });
  assert.equal(t.controller.state.postCall, null);
  t.controller.applyShellState({ postCall: postCall("ready", { changes: [{ key: "deal:amount", to: "5000" }, { label: "no key" }], email: { state: "bogus" } }) });
  assert.equal(t.controller.state.postCall?.changes.length, 1);
  assert.equal(t.controller.state.postCall?.email, null);
  assert.equal(t.controller.state.postCall?.changes[0].label, "deal:amount", "label falls back to the key");
});

test("a task's day and hour reach the island, and a change that is not a task has none", () => {
  const t = setup();
  t.controller.applyShellState({
    postCall: postCall("ready", {
      changes: [
        { key: "task:next_step_task_0", to: "Llamar a Ana", when: "Tue 20 Oct, 18:30", whenSuggested: false },
        { key: "task:next_step_task_1", to: "Enviar la propuesta", when: "Sat 17 Oct, 09:00", whenSuggested: true },
        { key: "deal:amount", to: "5000" },
      ],
    }),
  });
  const changes = t.controller.state.postCall?.changes ?? [];
  assert.deepEqual(changes.map((c) => [c.when, c.whenSuggested]), [["Tue 20 Oct, 18:30", false], ["Sat 17 Oct, 09:00", true], [null, false]]);
});

/* ---------- calling the CRM contact on screen ---------- */

const ana = { provider: "hubspot", crmLabel: "HubSpot", name: "Ana Ruiz", phone: "+34600111222", callerId: "+34910000000", state: "callable" };
const dialState = (phase: string, extra: Record<string, unknown> = {}) => ({ phase, name: "Ana Ruiz", phone: "+34600111222", muted: false, ...extra });

test("the contact on screen opens the confirm row, and Call sends one dial", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  assert.equal(t.controller.state.onScreen?.name, "Ana Ruiz");
  t.controller.act({ name: "openDialConfirm" });
  assert.equal(t.mode(), "dialConfirm");
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "dial" });
  t.controller.act({ name: "dial" });
  assert.deepEqual(t.commands(), ["dial"]);
  assert.equal(t.mode(), "dialing");
});

test("the open island at rest shows the contact on screen, and Call there dials it", () => {
  const t = setup();
  t.controller.toggle();
  assert.equal(t.controller.state.expanded, true);
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "dial" });
  assert.deepEqual(t.commands(), ["dial"]);
  assert.equal(t.mode(), "dialing");
});

test("Call is not taken from the closed island", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "dial" });
  assert.deepEqual(t.commands(), []);
  assert.equal(t.mode(), "idle");
});

test("a dial the dashboard never reports says so on the island for a moment, and never opens the dashboard", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.advance(8.1);
  assert.equal(t.mode(), "dialing");
  assert.deepEqual([t.controller.state.dial?.phase, t.controller.state.dial?.message], ["ended", "Couldn't start the call"]);
  assert.equal(t.log.mainWindow, 0);
  t.advance(4.1);
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.dial, null);
  assert.equal(t.log.mainWindow, 0);
});

test("the confirm row also records, as the open island at rest does", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "record" });
  assert.equal(t.mode(), "starting");
  assert.ok(t.commands().includes("listen"));
});

test("closing the confirm row goes back to rest", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.collapse();
  assert.equal(t.mode(), "idle");
});

test("a contact without a caller ID sends the rep to the calling settings, not a dial", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: { ...ana, callerId: null, state: "no_caller_id" } });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.controller.act({ name: "openCalling" });
  assert.deepEqual(t.commands(), ["open-calling"]);
  assert.equal(t.mode(), "idle");
});

test("a call placed anywhere shows as dialing, and a missed one says why until the dashboard clears it", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  assert.equal(t.mode(), "dialing");
  t.controller.applyShellState({ dial: dialState("ended", { message: "Busy" }) });
  assert.equal(t.mode(), "dialing");
  assert.equal(t.controller.state.dial?.message, "Busy");
  t.controller.applyShellState({ dial: null });
  assert.equal(t.mode(), "idle");
});

test("while a Vocify call is up: no call offer, no Record, no shortcut", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.shortcutPressed();
  assert.equal(t.mode(), "dialing");
  assert.deepEqual(t.commands(), []);
});

test("in the call: mute, keypad digits and hang up are the dashboard's commands", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1_700_000_000_000 }) });
  t.controller.show();
  assert.equal(t.mode(), "recording");
  t.controller.act({ name: "toggleMute" });
  t.controller.act({ name: "keypad", open: true });
  assert.equal(t.controller.state.keypadOpen, true);
  t.controller.act({ name: "digit", digit: "5" });
  t.controller.act({ name: "hangup" });
  assert.deepEqual(t.commands(), ["mute", "digit:5", "hangup"]);
  assert.equal(t.mode(), "finishing");
});

test("a call the prospect hung up holds the island until its memo arrives", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("active") });
  t.controller.show();
  t.controller.applyShellState({ dial: null });
  assert.equal(t.mode(), "finishing");
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
});

test("recording a Vocify call ignores other apps letting go of the mic", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.applyShellState({ dial: dialState("active") });
  t.controller.show();
  t.controller.callChanged(null);
  t.advance(5);
  assert.equal(t.mode(), "recording");
});

test("answering moves the island to the call's live view at once, as open as the rep had it", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  assert.equal(t.mode(), "dialing");
  assert.equal(t.controller.state.expanded, true);
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1 }) });
  assert.equal(t.mode(), "recording");
  assert.equal(t.controller.state.expanded, true);
  // The dashboard's own start a moment later changes nothing the rep sees.
  t.controller.show();
  assert.equal(t.mode(), "recording");
  assert.equal(t.controller.state.expanded, true);
});

test("a call answered while the island was closed stays closed", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  t.controller.act({ name: "toggle" });
  assert.equal(t.controller.state.expanded, false);
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1 }) });
  assert.equal(t.mode(), "recording");
  assert.equal(t.controller.state.expanded, false);
});

test("a call that starts answered (the dashboard's own dialer) opens in the live view", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1 }) });
  assert.equal(t.mode(), "recording");
  assert.equal(t.controller.state.expanded, true);
});

test("an answered call that ends before the live session started holds the island on 'processing' until the memo", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1 }) });
  assert.equal(t.mode(), "recording");
  t.controller.applyShellState({ dial: null });
  assert.equal(t.mode(), "finishing");
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
});

test("a missed call ending goes back to rest, not to processing", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  t.controller.applyShellState({ dial: dialState("ended", { message: "No answer" }) });
  t.controller.applyShellState({ dial: null });
  assert.equal(t.mode(), "idle");
});

/* ---------- a meeting about to start (shell:state meeting, from the calendar) ---------- */

const soonMeeting = (id = "ev-1") => ({
  id,
  who: "Marta García",
  title: "Demo Vocify",
  startsAt: new Date(1_700_000_060_000).toISOString(),
  url: "https://meet.google.com/abc-defg-hij",
  platform: "meet",
});

test("a meeting about to start opens the resting island once, for a minute", () => {
  const t = setup();
  t.controller.applyShellState({ meeting: soonMeeting() });
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.meeting?.who, "Marta García");
  t.advance(59);
  assert.equal(t.controller.state.expanded, true);
  t.advance(2);
  assert.equal(t.controller.state.expanded, false);
  // The dashboard sends it again on its next refresh: not announced twice.
  t.controller.applyShellState({ meeting: null });
  t.controller.applyShellState({ meeting: soonMeeting() });
  assert.equal(t.controller.state.expanded, false);
});

test("on a call the meeting does not interrupt", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.advance(1);
  const before = t.mode();
  t.controller.applyShellState({ meeting: soonMeeting() });
  assert.equal(t.mode(), before);
  assert.equal(t.controller.state.meeting?.id, "ev-1");
});

test("a meeting that came up during a call is announced once the island is back at rest", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.advance(1);
  t.controller.applyShellState({ meeting: soonMeeting() });
  t.controller.act({ name: "dismissCall" });
  // The call card is gone, the meeting is still due, and nothing has announced it yet.
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.meeting?.id, "ev-1");
  // Announced once: it closing on its own does not bring it back.
  t.advance(70);
  assert.equal(t.controller.state.expanded, false);
  t.controller.callChanged(null);
  assert.equal(t.controller.state.expanded, false);
});

test("a meeting that came up while the after-call card was open is announced when the card is dismissed", () => {
  const t = setup();
  t.controller.applyShellState({ postCall: postCall("ready") });
  assert.equal(t.mode(), "postCall");
  t.controller.applyShellState({ meeting: soonMeeting() });
  assert.equal(t.mode(), "postCall");
  t.controller.applyShellState({ postCall: null });
  assert.equal(t.mode(), "idle");
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.meeting?.id, "ev-1");
});

test("Join opens the meeting's link; closing it hides that meeting for good", () => {
  const opened: string[] = [];
  const t = setup();
  (t.controller as unknown as { effects: Effects }).effects.openExternal = (url) => void opened.push(url);
  t.controller.applyShellState({ meeting: soonMeeting() });
  t.controller.act({ name: "joinMeeting" });
  assert.deepEqual(opened, ["https://meet.google.com/abc-defg-hij"]);
  assert.equal(t.controller.state.expanded, false);
  t.controller.act({ name: "dismissMeeting" });
  assert.equal(t.controller.state.meeting, null);
  t.controller.applyShellState({ meeting: soonMeeting() });
  assert.equal(t.controller.state.meeting, null);
  t.controller.applyShellState({ meeting: soonMeeting("ev-2") });
  assert.equal(t.controller.state.meeting?.id, "ev-2");
});

test("a meeting moved to another time is announced again, and closing it only hides that time", () => {
  const t = setup();
  const at = (minutes: number) => ({ ...soonMeeting(), startsAt: new Date(1_700_000_060_000 + minutes * 60_000).toISOString() });
  t.controller.applyShellState({ meeting: at(0) });
  assert.equal(t.controller.state.expanded, true);
  t.controller.act({ name: "dismissMeeting" });
  assert.equal(t.controller.state.expanded, false);
  // The same calendar event, moved to later: a new occasion.
  t.controller.applyShellState({ meeting: at(70) });
  assert.equal(t.controller.state.meeting?.id, "ev-1");
  assert.equal(t.controller.state.expanded, true);
  // The closed time stays closed.
  t.controller.act({ name: "dismissMeeting" });
  t.controller.applyShellState({ meeting: at(70) });
  assert.equal(t.controller.state.meeting, null);
});

test("a refused browser shows on the island, and Fix opens Vocify on how to allow it", () => {
  const t = setup();
  t.controller.setCrmBlocked("Google Chrome");
  assert.deepEqual(t.controller.state.crmBlocked, { browser: "Google Chrome" });
  t.controller.act({ name: "toggle" });
  t.controller.act({ name: "fixCrmAccess" });
  assert.equal(t.log.mainWindow, 1);
  assert.deepEqual(t.commands(), ["open-crm-access"]);
  assert.equal(t.controller.state.expanded, false);
  t.controller.setCrmBlocked(null);
  assert.equal(t.controller.state.crmBlocked, null);
});

/* ---------- a call on the rep's own phone (Vocify calling off) ---------- */

const phoneCall: Caller = { name: "FaceTime", appId: "com.apple.avconferenced" };

/** Call pressed on the contact on screen, and the phone opened it (the OS's own confirm is still to be clicked). */
const dialOnPhone = () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: { ...ana, callerId: null } });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.controller.phoneDialed();
  return t;
};

test("a call opened on the phone waits for it to connect, and records nothing yet", () => {
  const t = dialOnPhone();
  assert.equal(t.mode(), "phoneCall");
  assert.equal(t.controller.state.mode.kind === "phoneCall" && t.controller.state.mode.name, "Ana Ruiz");
  assert.equal(t.controller.state.expanded, true);
  assert.deepEqual(t.commands(), ["dial"]);
  t.advance(8.1);
  assert.equal(t.mode(), "phoneCall", "no 'Couldn't start the call' once the phone has it");
});

test("the call connecting (its call service takes the mic) starts the recording, and the hang-up ends it", () => {
  const t = dialOnPhone();
  t.advance(10);
  t.controller.callChanged(phoneCall);
  assert.equal(t.mode(), "starting");
  assert.deepEqual(t.commands(), ["dial", "listen"]);
  t.controller.show();
  assert.equal(t.mode(), "recording");
  t.advance(120);
  t.controller.callChanged(null);
  t.advance(3.1);
  assert.equal(t.mode(), "stopped");
  assert.equal(t.controller.state.mode.kind === "stopped" && t.controller.state.mode.title, "Call ended");
});

test("a detected call does not stop the rep calling the contact on screen, and backing out returns to the call offer", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: { ...ana, callerId: null } });
  t.controller.callChanged({ name: "Zoom", appId: "us.zoom.xos", holding: ["us.zoom.xos"] });
  assert.equal(t.mode(), "call");
  t.controller.act({ name: "openDialConfirm" });
  assert.equal(t.mode(), "dialConfirm");
  t.controller.act({ name: "toggle" });
  assert.equal(t.mode(), "call", "the offer to record Zoom is still there");
  assert.equal(t.controller.state.expanded, false);
});

test("another app already on the mic (WhatsApp) is not the call: recording waits for the call service, and only its letting go hangs up", () => {
  const t = dialOnPhone();
  t.advance(2);
  t.controller.callChanged({ name: "WhatsApp", appId: "net.whatsapp.WhatsApp", holding: ["net.whatsapp.WhatsApp"] });
  assert.equal(t.mode(), "phoneCall", "WhatsApp sitting on the mic is not the call");
  t.advance(5);
  t.controller.callChanged({ name: "WhatsApp", appId: "net.whatsapp.WhatsApp", holding: ["com.apple.avconferenced", "net.whatsapp.WhatsApp"] });
  assert.equal(t.mode(), "starting", "the call service joined the mic: connected");
  t.controller.show();
  assert.equal(t.mode(), "recording");
  // The call ends: FaceTime lets go, WhatsApp still holds the mic.
  t.controller.callChanged({ name: "WhatsApp", appId: "net.whatsapp.WhatsApp", holding: ["net.whatsapp.WhatsApp"] });
  t.advance(3.1);
  assert.equal(t.mode(), "stopped");
});

test("a call that never connects says so with a way to set it up, and lets the contact go", () => {
  const t = dialOnPhone();
  t.advance(45.1);
  assert.equal(t.mode(), "phoneCall");
  assert.equal(t.controller.state.mode.kind === "phoneCall" && t.controller.state.mode.failed, true);
  assert.ok(t.emitted.some((e) => e.channel === "call:ended"), "the dashboard forgets the contact it was holding");
  assert.ok(!t.commands().includes("listen"));
  t.controller.callChanged(phoneCall);
  assert.equal(t.mode(), "phoneCall", "too late: it is not taken for this call");
  t.controller.act({ name: "setUpPhone" });
  assert.equal(t.mode(), "idle");
  assert.deepEqual(t.commands().slice(-1), ["open-phone-setup"]);
});

test("the 'didn't connect' card closes by itself", () => {
  const t = dialOnPhone();
  t.advance(45.1);
  t.advance(10.1);
  assert.equal(t.mode(), "idle");
});

test("Cancel stops waiting for the call", () => {
  const t = dialOnPhone();
  t.controller.act({ name: "cancelPhoneCall" });
  assert.equal(t.mode(), "idle");
  assert.ok(t.emitted.some((e) => e.channel === "call:ended"));
  t.advance(60);
  assert.equal(t.mode(), "idle");
  t.controller.callChanged(phoneCall);
  assert.equal(t.mode(), "call", "a call after that is offered like any other");
});

test("a phone that could not open the call says so on the island, and records nothing", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: { ...ana, callerId: null } });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.controller.phoneDialFailed("No app on this computer makes phone calls");
  assert.equal(t.mode(), "dialing");
  assert.deepEqual([t.controller.state.dial?.phase, t.controller.state.dial?.message], ["ended", "No app on this computer makes phone calls"]);
  assert.deepEqual(t.commands(), ["dial"]);
  t.advance(4.1);
  assert.equal(t.mode(), "idle");
  assert.equal(t.log.mainWindow, 0);
});

test("a phone call reported after the island moved on is ignored", () => {
  const t = setup();
  t.controller.phoneDialed();
  t.controller.phoneDialFailed("x");
  assert.equal(t.mode(), "idle");
  assert.deepEqual(t.commands(), []);
});

/* ---------- a recording that ends with nothing to keep ---------- */

test("a recording the dashboard did not keep (an unanswered call) says why for a moment, then rests", () => {
  const t = setup();
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.act({ name: "stop" });
  t.controller.finishRecording();
  assert.equal(t.mode(), "finishing");
  t.controller.applyShellState({ finish: { step: "skipped", message: "No answer. Nothing was saved." } });
  assert.equal(t.controller.state.expanded, true);
  assert.equal(t.controller.state.finish?.message, "No answer. Nothing was saved.");
  t.advance(4.1);
  assert.equal(t.mode(), "idle");
});

/* ---------- a call on the phone heard through the PC's sound (Windows) ---------- */

const dialOnPhoneHeard = () => {
  const t = setup({ callSound: true });
  t.controller.applyShellState({ onScreen: { ...ana, callerId: null } });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.controller.phoneDialed();
  return t;
};

test("where the call is heard, not seen on the mic: its sound starts the recording", () => {
  const t = dialOnPhoneHeard();
  assert.ok(t.log.soundWatch, "listening while the island waits");
  t.advance(6);
  t.log.soundWatch?.();
  assert.equal(t.mode(), "starting");
  assert.deepEqual(t.commands(), ["dial", "listen"]);
  t.controller.show();
  assert.equal(t.mode(), "recording");
});

test("15 s with no call sound and the rep not speaking ends it, as a hang-up", () => {
  const t = dialOnPhoneHeard();
  t.log.soundWatch?.();
  t.controller.show();
  for (let i = 0; i < 60; i++) {
    t.controller.applyShellState({ callActivity: { them: i % 2 === 0, you: false } });
    t.advance(1);
  }
  assert.equal(t.mode(), "recording", "a call with sound keeps going");
  for (let i = 0; i < 30; i++) {
    t.controller.applyShellState({ callActivity: { them: false, you: true } });
    t.advance(1);
  }
  assert.equal(t.mode(), "recording", "the rep talking alone is still the call");
  // The last activity was the loop's last second: 15 s on from it, the call has gone quiet.
  t.controller.applyShellState({ callActivity: { them: false, you: false } });
  t.advance(13);
  assert.equal(t.mode(), "recording");
  t.advance(1.1);
  assert.equal(t.mode(), "stopped");
  assert.equal(t.controller.state.mode.kind === "stopped" && t.controller.state.mode.title, "Call ended");
});

test("other recordings never end on silence", () => {
  const t = setup({ callSound: true });
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.applyShellState({ callActivity: { them: false, you: false } });
  t.advance(120);
  assert.equal(t.mode(), "recording");
});

test("the listening stops once the call is heard, cancelled, or never connects", () => {
  const heard = dialOnPhoneHeard();
  heard.log.soundWatch?.();
  assert.equal(heard.log.soundStops, 0, "heard: its capture is handed to the recording, not stopped here");
  const cancelled = dialOnPhoneHeard();
  cancelled.controller.act({ name: "cancelPhoneCall" });
  assert.equal(cancelled.log.soundStops, 1);
  const never = dialOnPhoneHeard();
  never.advance(45.1);
  assert.equal(never.log.soundStops, 1);
});

test("a paused call on the phone never ends on silence", () => {
  const t = dialOnPhoneHeard();
  t.log.soundWatch?.();
  t.controller.show();
  t.controller.applyShellState({ paused: true });
  t.advance(120);
  assert.equal(t.mode(), "recording");
  t.controller.applyShellState({ paused: false });
  t.advance(15.1);
  assert.equal(t.mode(), "stopped", "after the pause, silence counts again");
});

test("the call's audio session stopping is its hang-up, with the same grace as any call app", () => {
  const t = dialOnPhoneHeard();
  t.log.soundWatch?.();
  t.controller.show();
  t.controller.callAudioEnded();
  t.advance(2);
  t.controller.callAudioBack();
  t.advance(10);
  assert.equal(t.mode(), "recording", "back within the grace: the call goes on");
  t.controller.callAudioEnded();
  t.advance(3.1);
  assert.equal(t.mode(), "stopped");
  assert.equal(t.controller.state.mode.kind === "stopped" && t.controller.state.mode.title, "Call ended");
});

test("the end of the recording stops following the call's audio", () => {
  const t = dialOnPhoneHeard();
  t.log.soundWatch?.();
  t.controller.show();
  const before = t.log.soundStops;
  t.controller.act({ name: "stop" });
  t.advance(10);
  assert.ok(t.log.soundStops > before);
});

test("an audio session stopping says nothing outside a call on the phone", () => {
  const t = setup({ callSound: true });
  t.controller.callChanged(zoom);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.callAudioEnded();
  t.advance(10);
  assert.equal(t.mode(), "recording");
});

test("a browser call named by its page is withdrawn when the mic lets go, and offered again on the next call", () => {
  const hubspot: Caller = { name: "HubSpot", appId: "chrome.exe", icon: null };
  const t = setup();
  t.controller.callChanged(hubspot);
  assert.equal(t.mode(), "call");
  t.controller.callChanged(null);
  assert.equal(t.mode(), "idle", "the rep never pressed Record: the offer goes with the audio");
  assert.notEqual(t.last("call:ended"), undefined);
  t.controller.callChanged(hubspot);
  assert.equal(t.mode(), "call", "the second call is offered");
});

test("a browser call that ends while the rep records stops the recording after the hang-up grace", () => {
  const hubspot: Caller = { name: "HubSpot", appId: "chrome.exe", icon: null };
  const t = setup();
  t.controller.callChanged(hubspot);
  t.controller.act({ name: "record" });
  t.controller.show();
  t.controller.callChanged(null);
  t.advance(2);
  assert.equal(t.mode(), "recording", "a brief drop of the mic is not the end of the call");
  t.advance(2);
  assert.equal(t.mode(), "stopped", "the mic released for the grace period ends the recording, as for Zoom");
});

test("a recording that is not a detected call (a Vocify call) does not hide the next call app", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1_700_000_000_000 }) });
  t.controller.show();
  t.controller.applyShellState({ dial: null });
  t.controller.hide(true);
  t.advance(31);
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "call");
});

test("a call app that takes the mic while the island waits for a memo is offered when the wait ends", () => {
  const t = recording();
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  t.controller.callChanged(null);
  t.controller.callChanged(zoom);
  assert.equal(t.mode(), "finishing");
  t.advance(31);
  assert.equal(t.mode(), "call");
});

/* ---------- the live call assistant ---------- */

// A payload as the dashboard pushes it under `liveBrain` (live-state-shell-contract.md).
const wirePoint = (extra: Record<string, unknown> = {}) => ({
  id: "p1", kind: "question", tag_key: "question", tag: null, title: "¿se integra con HubSpot?", said_at: 40, decision: "responder", decision_note: null,
  answer: "Sí.", fallback: null, gap: null, source: { id: "knowledge", label: "Conocimiento" }, repeated: false, outcome: "open", ...extra,
});
const wire = (extra: Record<string, unknown> = {}) => ({
  on: true, call_id: "c1",
  state: {
    version: 3, points: [wirePoint()],
    progress: {
      playbook: { key: "cold", name: "Llamada en frío" }, has_playbook: true, goal: null, missing: ["b", "d"],
      steps: { a: { id: "a", status: "done", by: "rep", quote: null } },
      data: { d1: { id: "d1", value: "HubSpot", quote: "usamos HubSpot", reread: true, by: "brain" } },
      now: { kind: "step", id: "b", say: "Cuéntame más." },
    },
  },
  playbook: {
    key: "cold", name: "Llamada en frío", has_playbook: true,
    steps: [{ id: "a", label: "Apertura", criterion: "c", example: "Hola", concept: "Preséntate", live: true }, { id: "b", label: "Problema", criterion: "c", example: null, concept: null, live: true }, { id: "x", label: "Tono", criterion: "c", example: null, concept: null, live: false }],
    data: [{ id: "d1", label: "CRM", good: "Qué CRM", question: "¿Qué CRM?" }, { id: "d2", label: "Comerciales", good: null, question: null }],
  },
  drafts: [], reading: { points: false, progress: false, recap: false }, offline_since: null, asks: { responder: null, recap: null }, type_changed: false,
  ...extra,
});

test("the live view the dashboard pushes becomes the island's; none, and the island is today's", () => {
  const t = recording();
  assert.equal(t.controller.state.live, null);
  t.controller.applyShellState({ liveBrain: wire() });
  assert.equal(t.controller.state.live?.on, true);
  assert.equal(t.controller.state.live?.points[0].title, "¿se integra con HubSpot?");
  assert.equal(t.controller.state.live?.points[0].source, "Conocimiento");
  t.controller.applyShellState({ liveBrain: null });
  assert.equal(t.controller.state.live, null);
});

test("the playbook's words are joined with what the call has done; coaching-only steps are never drawn", () => {
  const t = recording();
  t.controller.applyShellState({ liveBrain: wire() });
  const progress = t.controller.state.live!.progress;
  assert.deepEqual(progress.steps.map((s) => [s.id, s.done, s.byRep, s.example]), [["a", true, true, "Hola"], ["b", false, false, null]]);
  assert.deepEqual(progress.data.map((d) => [d.id, d.done, d.value, d.reread, d.question]), [["d1", true, "HubSpot", true, "¿Qué CRM?"], ["d2", false, null, false, null]]);
  assert.deepEqual(progress.missing, ["b", "d"]);
  assert.deepEqual(progress.now, { kind: "step", id: "b", say: "Cuéntame más." });
  assert.equal(progress.goal, null, "the goal is drawn once it is named");
});

test("the goal is named when it is reached, picked or the one to do now", () => {
  const t = recording();
  const withProgress = (progress: Record<string, unknown>) => wire({ state: { ...wire().state, progress: { ...wire().state.progress, ...progress } } });
  t.controller.applyShellState({ liveBrain: withProgress({ missing: ["b", "goal"] }) });
  assert.deepEqual(t.controller.state.live!.progress.goal, { label: null, done: false, byRep: false, value: null, quote: null });
  t.controller.applyShellState({ liveBrain: withProgress({ goal: { reached: true, value: "Jueves 10:00", quote: "vale", by: "brain" } }) });
  assert.equal(t.controller.state.live!.progress.goal?.done, true);
  assert.equal(t.controller.state.live!.progress.goal?.value, "Jueves 10:00");
});

test("a malformed point is dropped, a point with nothing written is thinking, drafts come after the points", () => {
  const t = recording();
  t.controller.applyShellState({
    liveBrain: wire({
      state: { ...wire().state, points: [wirePoint({ id: "" }), wirePoint({ id: "p2", answer: null, fallback: null }), wirePoint({ id: "p3", outcome: "later" }), wirePoint({ id: "p4", answer: null, fallback: "Te lo confirmo.", gap: "No está" })] },
      drafts: [{ title: "¿y el precio?", say: "Depende", grounded: null }, { title: null, say: null, grounded: null }],
    }),
  });
  assert.deepEqual(t.controller.state.live?.points.map((p) => [p.id, p.phase, p.draft]), [["p2", "thinking", false], ["p4", "ready", false], ["draft:0", "writing", true], ["draft:1", "thinking", true]]);
});

test("the answers to the asks are kept with their seq", () => {
  const t = recording();
  t.controller.applyShellState({
    liveBrain: wire({
      asks: { responder: { seq: 2, status: "found", point_id: "p1" }, recap: { seq: 1, status: "ready", up_to_t: 61, lines: ["Marta."], unknown: ["CRM"] } },
      offline_since: 1_700_000_000_000,
    }),
  });
  const live = t.controller.state.live!;
  assert.deepEqual(live.asks.responder, { seq: 2, status: "found", pointId: "p1" });
  assert.deepEqual(live.asks.recap, { seq: 1, status: "ready", upTo: 61, lines: ["Marta."], unknown: ["CRM"] });
  assert.equal(live.offlineSince, 1_700_000_000_000);
});

test("the open tab is the island's, goes to the dashboard, and every recording starts on its transcript", () => {
  const t = recording();
  t.controller.applyShellState({ liveBrain: wire() });
  assert.equal(t.controller.state.liveTab, "transcript");
  t.controller.act({ name: "liveTab", tab: "conversation" });
  assert.equal(t.controller.state.liveTab, "conversation");
  assert.deepEqual(t.last("livebrain:action"), { type: "tab", tab: "conversation" });
  t.controller.stop(false);
  t.advance(10);
  assert.equal(t.controller.state.liveTab, "transcript");
});

test("asks, ticks and dismissals reach the dashboard as its contract names them; without the live view they go nowhere", () => {
  const t = recording();
  t.controller.act({ name: "liveAsk", ask: "respond" });
  assert.equal(t.last("livebrain:action"), undefined);
  t.controller.applyShellState({ liveBrain: wire() });
  const sent = (action: Parameters<typeof t.controller.act>[0]) => (t.controller.act(action), t.last("livebrain:action"));
  assert.deepEqual(sent({ name: "liveAsk", ask: "respond" }), { type: "responder" });
  assert.deepEqual(sent({ name: "liveAsk", ask: "now" }), { type: "preguntar" });
  assert.deepEqual(sent({ name: "liveAsk", ask: "recap" }), { type: "resumen" });
  assert.deepEqual(sent({ name: "liveTick", kind: "step", id: "apertura", on: true }), { type: "tick", id: "apertura", kind: "step" });
  assert.deepEqual(sent({ name: "liveTick", kind: "data", id: "crm", on: false }), { type: "untick", id: "crm", kind: "data" });
  assert.deepEqual(sent({ name: "liveDismiss", id: "p1" }), { type: "dismiss", id: "p1" });
});

test("the Qué decir view: its view, the cards' source turns and versions, a deepen card, step parts, the new asks and the contact", () => {
  const t = recording();
  t.controller.applyShellState({ liveBrain: wire() });
  assert.equal(t.controller.state.live?.view, "tabs", "a dashboard that names no view keeps the tabs");
  assert.deepEqual(t.controller.state.live?.points[0].versions, ["Sí."], "with no versions sent, the answer is the one version");
  assert.deepEqual(t.controller.state.live?.points[0].turnIds, []);
  assert.equal(t.controller.state.live?.contact, null);
  const say = wire({
    view: "say",
    state: {
      ...wire().state,
      points: [
        wirePoint({ turn_ids: ["t6"], versions: ["Sí.", "Sí, ¿qué no queréis que se toque?", " "] }),
        wirePoint({ id: "p2", kind: "deepen", tag: "Dolor", title: "se rellena tarde", answer: "¿Cuánto tiempo os lleva?", turn_ids: ["t4"] }),
        wirePoint({ id: "p3", kind: "advice", title: "nunca" }),
      ],
      progress: { ...wire().state.progress, parts: { b: { crm: { quote: "usamos HubSpot" } } } },
    },
    playbook: { ...wire().playbook, steps: [...wire().playbook.steps.slice(0, 1), { id: "b", label: "Cualificar", criterion: "c", example: null, concept: null, live: true, need: 9, parts: [{ id: "crm", label: "CRM" }, { id: "n", label: "Comerciales" }, { id: "", label: "sin id" }] }] },
    asks: {
      responder: { seq: 2, status: "nothing", point_id: null, next: { kind: "data", id: "d2", label: "Comerciales", question: "¿Cuántos sois?" } },
      recap: null,
      step: { seq: 1, kind: "step", id: "b", status: "ready", question: "¿Qué CRM usáis?" },
      rewrite: { seq: 4, point_id: "p1", status: "none" },
    },
    contact: { name: "Marta Ruiz", company: "Acme", first: false, lines: ["Hablasteis hace dos semanas.", ""] },
  });
  t.controller.applyShellState({ liveBrain: say });
  const live = t.controller.state.live!;
  assert.equal(live.view, "say");
  assert.deepEqual(live.points.map((p) => [p.id, p.kind, p.turnIds, p.versions.length]), [["p1", "question", ["t6"], 2], ["p2", "deepen", ["t4"], 1]], "an unknown kind is dropped, never guessed");
  const step = live.progress.steps.find((s) => s.id === "b")!;
  assert.deepEqual(step.parts, [{ id: "crm", label: "CRM", done: true, quote: "usamos HubSpot" }, { id: "n", label: "Comerciales", done: false, quote: null }]);
  assert.equal(step.need, 2, "never more parts needed than there are");
  assert.equal(live.progress.steps[0].parts, null);
  assert.deepEqual(live.asks.next, { kind: "data", id: "d2", label: "Comerciales", question: "¿Cuántos sois?" });
  assert.deepEqual(live.asks.step, { seq: 1, kind: "step", id: "b", status: "ready", question: "¿Qué CRM usáis?" });
  assert.deepEqual(live.asks.rewrite, { seq: 4, pointId: "p1", status: "none" });
  assert.deepEqual(live.contact, { name: "Marta Ruiz", company: "Acme", first: false, lines: ["Hablasteis hace dos semanas."] });
  t.controller.applyShellState({ liveBrain: wire({ view: "say", contact: { name: " ", first: true } }) });
  assert.equal(t.controller.state.live?.contact, null, "a contact with no name has no brief");
});

test("the Qué decir view's asks reach the dashboard as the contract names them", () => {
  const t = recording();
  t.controller.applyShellState({ liveBrain: wire({ view: "say" }) });
  const sent = (action: Parameters<typeof t.controller.act>[0]) => (t.controller.act(action), t.last("livebrain:action"));
  assert.deepEqual(sent({ name: "liveRewrite", id: "p1", version: 1 }), { type: "rewrite", id: "p1", version: 1 });
  assert.deepEqual(sent({ name: "liveAskStep", kind: "step", id: "b" }), { type: "ask_step", kind: "step", id: "b" });
  assert.deepEqual(sent({ name: "liveRespondTurn", turnId: "t6" }), { type: "responder_turn", turn_id: "t6" });
  assert.deepEqual(sent({ name: "liveEvent", event: "open_steps" }), { type: "event", kind: "open_steps" });
  assert.deepEqual(sent({ name: "liveEvent", event: "marker_seen", id: "p1" }), { type: "event", kind: "marker_seen", id: "p1" });
});

test("where the recording sits: the saved choice from the start, and a change shows at once", () => {
  const t = recording();
  assert.equal(t.controller.state.placement, "notch");
  t.controller.setPlacement("side");
  assert.equal(t.controller.state.placement, "side");
  t.controller.setPlacement("notch");
  assert.equal(t.controller.state.placement, "notch");
});

test("the open recording is 400 high, and 460 only while Conversación is open (never over half the screen)", () => {
  const g = { notchWidth: 185, barHeight: 32, screenHeight: 982 };
  assert.equal(islandSize(g, "recording", true).height, 400);
  assert.equal(islandSize(g, "recording", true, undefined, 0, false, true).height, 460);
  assert.equal(islandSize({ ...g, screenHeight: 800 }, "recording", true, undefined, 0, false, true).height, 400);
  assert.equal(islandSize(g, "recording", false, undefined, 0, false, true).height, 32);
  assert.equal(showsConversation({ mode: { kind: "recording" }, live: {}, liveTab: "conversation" }), true);
  assert.equal(showsConversation({ mode: { kind: "recording" }, live: null, liveTab: "conversation" }), false, "today's island never grows");
  assert.equal(showsConversation({ mode: { kind: "recording" }, live: {}, liveTab: "help" }), false);
});

test("with the finished calls kept by the dashboard, a recording that was not kept still says why, and a call that could not be written is only its job's line", () => {
  const t = recording();
  t.controller.applyShellState({ background: [] });
  t.controller.act({ name: "stop" });
  t.controller.act({ name: "finish" });
  assert.equal(t.mode(), "idle");
  t.controller.applyShellState({ finish: { step: "skipped", message: "No answer. Nothing was saved." } });
  assert.equal(t.mode(), "finishing");
  assert.equal(t.controller.state.expanded, true);
  t.advance(10);
  assert.equal(t.mode(), "idle", "the line runs out");
  const u = recording();
  u.controller.applyShellState({ background: [] });
  u.controller.act({ name: "stop" });
  u.controller.act({ name: "finish" });
  u.controller.applyShellState({ background: [{ id: "d1", name: "Marta", state: "failed" }] });
  u.controller.applyShellState({ finish: { step: "failed", message: "Couldn't send the meeting." } });
  assert.equal(u.mode(), "idle", "the failed line says it; no second card");
});
