import assert from "node:assert/strict";
import { test } from "node:test";
import type { IslandState, Levels } from "../../island/src/types.ts";
import { IslandController, type Caller, type Effects } from "../src/controller.ts";

/** A clock and timer queue the tests move by hand, plus a record of everything the controller does outside itself. */
function setup(options: { recorderReady?: boolean } = {}) {
  let now = 1_700_000_000_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const emitted: { channel: string; payload: unknown }[] = [];
  const log = { mainWindow: 0, saved: [] as boolean[], states: [] as IslandState[], levels: [] as Levels[], contactLookups: 0, sourceLookups: 0 };
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

test("tapping Vocify's ticked proposal confirms it as the rep's own", () => {
  const t = recording();
  t.controller.applyShellState({ liveType: { selected: "discovery", proposed: true, options: [{ key: "discovery", label: "Discovery call" }] } });
  t.controller.act({ name: "pickCallType", key: "discovery" });
  assert.equal(t.controller.state.typeMenu?.proposed, false);
  assert.deepEqual(t.last("call:type"), { key: "discovery" });
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
  for (const type of ["review", "openEmail", "notes"]) t.controller.act({ name: "postCall", type });
  assert.equal(t.log.mainWindow, 3);
  t.controller.act({ name: "postCall", type: "undo" });
  assert.equal(t.log.mainWindow, 3);
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

test("a dial the dashboard never reports returns to idle after 8 s", () => {
  const t = setup();
  t.controller.applyShellState({ onScreen: ana });
  t.controller.act({ name: "openDialConfirm" });
  t.controller.act({ name: "dial" });
  t.advance(8.1);
  assert.equal(t.mode(), "idle");
  assert.equal(t.log.mainWindow, 1);
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

test("an answered call that ends while the island shows the call holds it on 'processing' until the memo", () => {
  const t = setup();
  t.controller.applyShellState({ dial: dialState("ringing") });
  t.controller.applyShellState({ dial: dialState("active", { answeredAt: 1 }) });
  assert.equal(t.mode(), "dialing");
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
