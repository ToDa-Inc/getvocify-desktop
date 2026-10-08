import { decodeDial, decodeOnScreen, isVocifyCallUp } from "../../core/callIsland.ts";
import { LostAudio } from "../../core/islandWording.ts";
import { StopGrace, type StopStep } from "../../core/stopGrace.ts";
import { TypeMenu } from "../../core/typeMenu.ts";
import { WaveSide } from "../../core/waveSide.ts";
import type { Assist, Geometry, IslandAction, IslandState, Levels, Mode, PostCallData } from "../../island/src/types.ts";
import { postCallPending } from "../../island/src/types.ts";
import { parseAssist, parseClock, parseContact, parseFinish, parseLiveType, parsePostCall, parseTurns, type LiveChannelKind, type LiveType } from "./parse.ts";

/**
 * The island's brain: what it shows and what each click does. A port of `MeetingPillController` and
 * `MeetingPillState.apply` (MeetingPill.swift), with every side effect injected so it can be tested with a fake clock.
 * Nothing here knows about windows or Electron.
 */

const AFTER_CALL_QUIET = 120;
const IDLE_LINGER = 5;
const CALL_LINGER = 8;
const POST_CALL_LINGER = 14;
const DONE_LINGER = 3;
/** A call app can drop the mic for a moment (device switch); a hang-up lasts. */
const HANG_UP_GRACE = 3;
const START_TIMEOUT = 8;
const MIN_HOLD_AFTER_LEAVE = 1.5;
const LEVEL_FADE_SECONDS = 0.5;
/** Waiting for the dashboard to report the call the rep just placed from the island. */
const DIAL_TIMEOUT = 8;
const DIGIT = /^[0-9*#]$/;
/** Waiting on a memo that never came (nothing was said, the upload failed): the dashboard says why in its window, and the island goes back to rest. */
const FINISH_GIVE_UP = 30;

/** The app holding the mic, as detection reports it. */
export type Caller = { name: string | null; appId: string | null; icon?: string | null };

export type Effects = {
  now(): number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  after(ms: number, fn: () => void): () => void;
  /** To the dashboard page: `__vocifyEmit(channel, payload)`. */
  emit(channel: string, payload: unknown): void;
  showMainWindow(): void;
  /** Full state, whenever anything but the voice levels changed. */
  onState(state: IslandState): void;
  /** Voice levels, about ten times a second; they never trigger a full state. */
  onLevels(levels: Levels): void;
  /** Remembered across launches so the island is not "signed out" while the dashboard is still loading. */
  saveRecorderReady(ready: boolean): void;
  /** Recording without a detected call: name the app holding the mic, if any (never asks for browser access). */
  lookUpCallSource?(caller: Caller | null): void;
  /** A call was detected: read the CRM page on screen and the call source. */
  lookUpCallContact?(caller: Caller | null): void;
};

type Timers = "autoClose" | "startTimeout" | "hangUp" | "finishTimeout" | "dialTimeout";

export class IslandController {
  private effects: Effects;
  private current: IslandState;
  /** Everything the dashboard has pushed, key by key (`listening` is read from here). */
  private shell: Record<string, unknown> = {};
  private liveType: LiveType | null = null;
  private grace: StopGrace | null = null;
  private cancels = new Map<Timers, () => void>();
  /** Set by a recording or a dismiss; cleared once the mic goes quiet, i.e. the call ended. */
  private callHandled = false;
  private lastPostCallStage: PostCallData["stage"] | null = null;
  /** The card on show when the recording ended: `finishing` waits for a newer one. */
  private finishingAfter: string | null = null;
  /** The call app being recorded; its letting go of the mic is the hang-up. */
  private recordingCaller: Caller | null = null;
  /** The call app holding the mic right now, as last reported. */
  private currentCaller: Caller | null = null;
  /** The caller the island is offering to record (what Record acts on, even if the mic's holder changed since). */
  private shownCaller: Caller | null = null;
  /** The app just recorded is not offered again for a while: dialers grab the mic again after a call. */
  private quiet: { appId: string; until: number } | null = null;
  private levelValues = { you: { value: 0, at: 0 }, them: { value: 0, at: 0 } };
  private shownSide: "you" | "them" = "them";
  /** The Vocify call on show was answered: its end waits for the memo ("processing"), not back to rest. */
  private dialAnswered = false;
  /** True when a native recorder draws the transcript itself; the dashboard's overlay then must not overwrite it. */
  nativeTranscript = false;

  constructor(effects: Effects, geometry: Geometry, options: { recorderReady?: boolean; material: IslandState["material"]; reduceMotion: boolean }) {
    this.effects = effects;
    this.current = {
      mode: { kind: "idle" },
      expanded: false,
      paused: false,
      recorderReady: options.recorderReady ?? false,
      callAudioLost: false,
      callContact: null,
      clock: null,
      levels: { you: 0, them: 0, side: "them", at: effects.now() },
      turns: [],
      assist: null,
      lastHelp: null,
      typeMenu: null,
      liveHelp: null,
      countdown: null,
      geometry,
      postCall: null,
      finish: null,
      onScreen: null,
      dial: null,
      keypadOpen: false,
      material: options.material,
      reduceMotion: options.reduceMotion,
    };
  }

  get state(): IslandState {
    return this.current;
  }

  /** The dashboard says it is recording (`shell:state` listening). */
  get isListening(): boolean {
    return this.shell.listening === true;
  }

  private set(patch: Partial<IslandState>): void {
    this.current = { ...this.current, ...patch };
    this.effects.onState(this.current);
  }

  private start(name: Timers, seconds: number, fn: () => void): void {
    this.stopTimer(name);
    this.cancels.set(name, this.effects.after(seconds * 1000, () => {
      this.cancels.delete(name);
      fn();
    }));
  }

  private stopTimer(name: Timers): void {
    this.cancels.get(name)?.();
    this.cancels.delete(name);
  }

  private get mode(): Mode["kind"] {
    return this.current.mode.kind;
  }

  /** A Vocify call is connecting, ringing or answered: nothing else may offer or start a recording. */
  private get vocifyCallUp(): boolean {
    return isVocifyCallUp(this.current.dial);
  }

  /* ---------- what the dashboard says (MeetingPillState.apply) ---------- */

  /** Applies one `shell:state` update; keys that are absent keep their value. */
  applyShellState(update: Record<string, unknown>): void {
    Object.assign(this.shell, update);
    const patch: Partial<IslandState> = {};
    const has = (key: string) => Object.prototype.hasOwnProperty.call(update, key);

    if (typeof update.paused === "boolean" && update.paused !== this.current.paused) patch.paused = update.paused;
    if (typeof update.recorderReady === "boolean" && update.recorderReady !== this.current.recorderReady) {
      patch.recorderReady = update.recorderReady;
      this.effects.saveRecorderReady(update.recorderReady);
    }
    let audioChange: [boolean, boolean] | null = null;
    if (typeof update.callAudioLost === "boolean" && update.callAudioLost !== this.current.callAudioLost) {
      audioChange = [this.current.callAudioLost, update.callAudioLost];
      patch.callAudioLost = update.callAudioLost;
    }
    let postCallChanged = false;
    if (has("postCall")) {
      const next = parsePostCall(update.postCall);
      if (JSON.stringify(next) !== JSON.stringify(this.current.postCall)) {
        patch.postCall = next;
        postCallChanged = true;
      }
    }
    let finishChanged = false;
    if (has("finish")) {
      const next = parseFinish(update.finish);
      if (JSON.stringify(next) !== JSON.stringify(this.current.finish)) {
        patch.finish = next;
        finishChanged = true;
      }
    }
    if (typeof update.liveHelp === "boolean" && update.liveHelp !== this.current.liveHelp) patch.liveHelp = update.liveHelp;
    if (has("liveType")) {
      const next = parseLiveType(update.liveType);
      if (JSON.stringify(next) !== JSON.stringify(this.liveType)) {
        this.liveType = next;
        patch.typeMenu = this.typeMenuView();
      }
    }
    if (has("onScreen")) {
      const next = decodeOnScreen(update.onScreen);
      if (JSON.stringify(next) !== JSON.stringify(this.current.onScreen)) patch.onScreen = next;
    }
    let dialChanged = false;
    if (has("dial")) {
      const next = decodeDial(update.dial);
      if (JSON.stringify(next) !== JSON.stringify(this.current.dial)) {
        patch.dial = next;
        if (next?.phase !== "active") patch.keypadOpen = false;
        dialChanged = true;
      }
    }
    if (has("callContact")) {
      const next = parseContact(update.callContact);
      if (next !== this.current.callContact) patch.callContact = next;
    }
    const clock = parseClock(update.clock);
    if (clock && JSON.stringify(clock) !== JSON.stringify(this.current.clock)) patch.clock = clock;
    if (update.levels !== undefined) this.applyLevels(update.levels);
    if (has("assist")) {
      const next = parseAssist(update.assist);
      if (JSON.stringify(next) !== JSON.stringify(this.current.assist)) {
        const previous = this.current.assist;
        if (previous && !previous.drafting && next === null) patch.lastHelp = previous;
        patch.assist = next;
      }
    }
    if (!this.nativeTranscript && has("overlay")) {
      const turns = parseTurns(update.overlay);
      if (turns && JSON.stringify(turns) !== JSON.stringify(this.current.turns)) patch.turns = turns;
    }

    if (Object.keys(patch).length === 0) return;
    this.set(patch);
    if (audioChange && LostAudio.opensIsland(audioChange[0], audioChange[1], this.mode === "recording", this.current.expanded)) {
      this.transition({ kind: "recording" }, true);
    }
    if (postCallChanged) this.postCallChanged();
    if (finishChanged) this.finishChanged();
    if (dialChanged) this.dialChanged();
  }

  private typeMenuView(): IslandState["typeMenu"] {
    if (!this.liveType) return null;
    const menu = new TypeMenu(this.liveType.options, this.liveType.selected, this.liveType.proposed);
    // Types by channel: the same menu says the channel first, unless it cannot change (a Vocify call).
    const live = this.liveType.channel;
    const channel = live && !live.fixed
      ? {
          title: live.options.find((option) => option.key === live.selected)?.label ?? live.selected,
          rows: live.options.map((option) => ({ key: option.key, label: option.label, checked: option.key === live.selected })),
        }
      : null;
    // "Reunión · Call type" would name the wrong thing: with a channel shown, no type yet is just "Type".
    const title = channel && menu.placeholder ? "Type" : menu.title;
    return { title, placeholder: menu.placeholder, sparkle: menu.sparkle, rows: menu.rows, channel };
  }

  private applyLevels(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const now = this.effects.now();
    const you = typeof (raw as { you?: unknown }).you === "number" ? (raw as { you: number }).you : 0;
    const them = typeof (raw as { them?: unknown }).them === "number" ? (raw as { them: number }).them : 0;
    if (you !== this.levelValues.you.value) this.levelValues.you = { value: you, at: now };
    if (them !== this.levelValues.them.value) this.levelValues.them = { value: them, at: now };
    const fade = (side: { value: number; at: number }) => side.value * Math.max(0, 1 - (now - side.at) / 1000 / LEVEL_FADE_SECONDS);
    // Whose voice the wave shows: it holds its colour through silence and near ties.
    this.shownSide = WaveSide.next(fade(this.levelValues.you), fade(this.levelValues.them), this.shownSide);
    this.current = { ...this.current, levels: { you, them, side: this.shownSide, at: now } };
    this.effects.onLevels(this.current.levels);
  }

  /* ---------- the island's own actions ---------- */

  act(action: IslandAction): void {
    switch (action.name) {
      case "toggle":
        return this.toggle();
      case "pointer":
        return this.pointer(action.inside);
      case "record":
        return this.record();
      case "dismissCall":
        this.callHandled = true;
        return this.hide();
      case "openApp":
        return this.effects.showMainWindow();
      case "togglePause":
        return this.effects.emit("shell:command", this.current.paused ? "resume" : "pause");
      case "stop":
        return this.stop(false);
      case "resume":
        return this.resumeRecording();
      case "finish":
        return this.finishRecording();
      case "pickCallType":
        return this.pickCallType(action.key);
      case "pickChannel":
        return this.pickChannel(action.kind);
      case "toggleLiveHelp":
        return this.effects.emit("shell:command", this.current.liveHelp === false ? "assist-on" : "assist-off");
      case "postCall":
        return this.postCallAction(action.type, action.details ?? {});
      case "openDialConfirm":
        return this.openDialConfirm();
      case "dial":
        return this.dial();
      case "hangup":
        return this.hangUpCall();
      case "toggleMute":
        if (this.current.dial?.phase === "active") this.effects.emit("shell:command", this.current.dial.muted ? "unmute" : "mute");
        return;
      case "keypad":
        return this.set({ keypadOpen: action.open });
      case "digit":
        if (DIGIT.test(action.digit)) this.effects.emit("shell:command", `digit:${action.digit}`);
        return;
      case "openCalling":
        this.transition({ kind: "idle" }, false);
        return this.effects.emit("shell:command", "open-calling");
    }
  }

  /* ---------- calling the CRM contact on screen ---------- */

  /** The phone beside the mark: who would be called, and from which number. */
  private openDialConfirm(): void {
    if (this.mode !== "idle" || !this.current.onScreen) return;
    this.transition({ kind: "dialConfirm" }, true);
    this.startCountdown(CALL_LINGER);
  }

  /** Places the call through the dashboard; the island follows its `dial` state. */
  private dial(): void {
    // From the confirm row, or straight from the open island at rest.
    const offered = this.mode === "dialConfirm" || (this.mode === "idle" && this.current.expanded);
    if (!offered || this.current.onScreen?.state !== "callable") return;
    if (!this.current.recorderReady) return this.effects.showMainWindow();
    this.dialAnswered = false;
    this.transition({ kind: "dialing" }, true);
    this.effects.emit("shell:command", "dial");
    this.start("dialTimeout", DIAL_TIMEOUT, () => {
      if (this.mode !== "dialing" || this.current.dial !== null) return;
      this.transition({ kind: "idle" }, false);
      this.effects.showMainWindow();
    });
  }

  /** Hangs up, or cancels while it rings. Answered, the island waits for the call's memo. */
  private hangUpCall(): void {
    if (this.mode === "recording") this.hide(true);
    this.effects.emit("shell:command", "hangup");
  }

  /** The dashboard moved the call on (from the island or its own dialer). */
  private dialChanged(): void {
    const dial = this.current.dial;
    if (dial) this.stopTimer("dialTimeout");
    if (dial?.phase === "active") this.dialAnswered = true;
    switch (this.mode) {
      case "idle":
      case "dialConfirm":
      case "call":
      case "postCall":
        if (dial && dial.phase !== "ended") this.transition({ kind: "dialing" }, true);
        return;
      case "dialing":
        if (!dial) {
          const answered = this.dialAnswered;
          this.dialAnswered = false;
          return answered ? this.finish() : this.rest();
        }
        // Missed: open to say why until the dashboard clears it.
        if (dial.phase === "ended" && !this.current.expanded) this.transition({ kind: "dialing" }, true);
        return;
      case "recording":
        // Answered and now over (either side hung up): hold the island until its memo arrives.
        if (!dial) this.hide(true);
        return;
      default:
        return;
    }
  }

  /** The record shortcut: the same as pressing Record, or Stop while recording. */
  shortcutPressed(): void {
    if (this.vocifyCallUp) return;
    switch (this.mode) {
      case "recording":
        return this.stop(false);
      case "stopped":
        return this.resumeRecording();
      case "starting":
      case "finishing":
        return;
      case "postCall":
        // A new call: the last one's card stays in Vocify.
        this.transition({ kind: "idle" }, false);
        return this.record();
      default:
        return this.record();
    }
  }

  toggle(): void {
    const { mode, expanded } = this.current;
    switch (mode.kind) {
      case "recording":
        return this.transition(mode, !expanded);
      case "idle":
      case "call":
        this.transition(mode, !expanded);
        if (this.current.expanded) this.startCountdown(mode.kind === "idle" ? IDLE_LINGER : CALL_LINGER);
        return;
      case "postCall":
        this.transition(mode, !expanded);
        if (this.current.expanded) this.startCountdown(POST_CALL_LINGER);
        return;
      case "finishing":
        // Closing a failure ends the wait; otherwise it just peeks at where the call is.
        if (this.current.finish?.step === "failed" && expanded) {
          this.stopTimer("finishTimeout");
          return this.rest();
        }
        return this.transition(mode, !expanded);
      case "dialConfirm":
        return this.transition({ kind: "idle" }, false);
      case "dialing":
        return this.transition(mode, !expanded);
      case "starting":
      case "stopped":
        return;
    }
  }

  collapse(): void {
    // The confirm row is only ever open: closing it is going back to rest.
    if (this.mode === "dialConfirm") this.transition({ kind: "idle" }, false);
    else if (this.current.expanded) this.transition(this.current.mode, false);
  }

  /** The pointer holds a self-closing card open; leaving lets the line run out again, never snapping it shut. */
  pointer(inside: boolean): void {
    const countdown = this.current.countdown;
    // The stop grace always runs out: a pointer resting where Stop was clicked must not hold the memo back.
    if (!countdown || !this.current.expanded || this.mode === "stopped") return;
    const now = this.effects.now();
    if (inside && countdown.runningSince !== null) {
      this.stopTimer("autoClose");
      this.set({ countdown: { ...countdown, remaining: countdown.remaining - (now - countdown.runningSince) / 1000, runningSince: null } });
    } else if (!inside && countdown.runningSince === null) {
      const remaining = Math.max(countdown.remaining, MIN_HOLD_AFTER_LEAVE);
      this.set({ countdown: { ...countdown, remaining, runningSince: now } });
      this.scheduleAutoClose(remaining);
    }
  }

  private startCountdown(total: number): void {
    this.set({ countdown: { total, remaining: total, runningSince: this.effects.now() } });
    this.scheduleAutoClose(total);
  }

  private scheduleAutoClose(seconds: number): void {
    this.start("autoClose", seconds, () => {
      if (this.current.countdown === null) return;
      const mode = this.current.mode;
      if (mode.kind === "stopped" && this.grace) {
        this.run(this.grace.onFinish);
      } else if (mode.kind === "postCall" && this.current.postCall?.stage === "done" && postCallPending(this.current.postCall) === 0) {
        this.postCallAction("dismiss", {});
      } else {
        this.collapse();
      }
    });
  }

  /** Pauses, says so with Resume, and ends once the grace runs out (see StopGrace). */
  stop(byHangUp: boolean): void {
    if (this.mode !== "recording") return;
    this.stopTimer("hangUp");
    const grace = new StopGrace(byHangUp, this.current.paused);
    this.grace = grace;
    this.run(grace.onStop);
    this.transition({ kind: "stopped", title: grace.title }, true);
    this.startCountdown(StopGrace.seconds);
  }

  /** Carries on recording the same call, as if Stop never happened. */
  resumeRecording(): void {
    if (this.mode !== "stopped" || !this.grace) return;
    const grace = this.grace;
    this.grace = null;
    this.run(grace.onResume);
    this.transition({ kind: "recording" }, false);
  }

  /** Ending the recording hands it to the dashboard; the memo is written in the background. */
  private run(steps: StopStep[]): void {
    for (const step of steps) {
      switch (step) {
        case "pause":
          this.effects.emit("shell:command", "pause");
          break;
        case "resume":
          this.effects.emit("shell:command", "resume");
          break;
        case "callEnded":
          this.effects.emit("call:ended", {});
          break;
        case "stop":
          this.grace = null;
          this.hide(true);
          this.effects.emit("shell:command", "stop");
          break;
      }
    }
  }

  /** Starts in the background so the call keeps focus; errors bring Vocify forward. Signed out, it opens Vocify to sign in. */
  record(): void {
    const previous = this.current.mode;
    if (this.vocifyCallUp) return;
    if (previous.kind !== "idle" && previous.kind !== "call") return;
    if (!this.current.recorderReady) return this.effects.showMainWindow();
    if (previous.kind === "call") this.recordingCaller = this.shownCaller;
    else this.effects.lookUpCallSource?.(this.currentCaller);
    this.transition({ kind: "starting" }, false);
    this.effects.emit("shell:command", "listen");
    this.start("startTimeout", START_TIMEOUT, () => {
      if (this.mode !== "starting") return;
      this.transition(previous, false);
      this.effects.showMainWindow();
    });
  }

  /** The dashboard started recording (`overlay:show`), from the island or from its own button. */
  show(): void {
    this.callHandled = true;
    this.stopTimer("startTimeout");
    // The dashboard ends a Vocify call; another app letting go of the mic says nothing about it.
    if (this.vocifyCallUp) this.recordingCaller = null;
    else if (this.current.mode.kind === "call") this.recordingCaller = this.shownCaller;
    else if (this.mode !== "recording") this.recordingCaller = this.currentCaller;
    this.transition({ kind: "recording" }, this.mode === "recording" && this.current.expanded);
  }

  /** Ends the stop grace now, without waiting for its line to run out. */
  finishRecording(): void {
    if (this.mode !== "stopped" || !this.grace) return;
    this.run(this.grace.onFinish);
  }

  /** Back to rest: the last call's update if one is pending, else the mark beside the camera. `finishing`: the recording just ended from the island; wait for its memo instead. */
  hide(finishing = false): void {
    this.stopTimer("startTimeout");
    this.stopTimer("hangUp");
    if ((this.mode === "recording" || this.mode === "stopped") && this.recordingCaller?.appId) {
      this.quiet = { appId: this.recordingCaller.appId, until: this.effects.now() + AFTER_CALL_QUIET * 1000 };
    }
    this.recordingCaller = null;
    this.set({ callContact: null });
    if (finishing) this.finish();
    // The dashboard hides the island as it stops; a finishing one keeps waiting.
    else if (this.mode !== "finishing") this.rest();
  }

  /** Holds the island on a spinner from the moment the recording ends until its memo is being written, so there is no gap where it looks idle and a new recording could start. */
  private finish(): void {
    this.finishingAfter = this.current.postCall?.memoId ?? null;
    this.stopTimer("autoClose");
    this.set({ finish: null, countdown: null });
    this.transition({ kind: "finishing" }, false);
    this.start("finishTimeout", FINISH_GIVE_UP, () => {
      if (this.mode === "finishing") this.rest();
    });
  }

  /** The dashboard says how the ended recording is going: a failure opens the island and stays. */
  private finishChanged(): void {
    if (this.mode !== "finishing" || this.current.finish?.step !== "failed") return;
    this.stopTimer("finishTimeout");
    this.transition({ kind: "finishing" }, true);
  }

  private rest(): void {
    const postCall = this.current.postCall;
    if (postCall) {
      this.lastPostCallStage = postCall.stage;
      const open = postCall.stage !== "writing";
      this.transition({ kind: "postCall" }, open);
      if (open && postCall.stage !== "applying") {
        this.startCountdown(postCall.stage === "done" && postCallPending(postCall) === 0 ? DONE_LINGER : POST_CALL_LINGER);
      }
    } else {
      this.transition({ kind: "idle" }, false);
    }
  }

  /** The type the rep chose while recording; null hands it back to Vocify's proposal. */
  private pickCallType(key: string | null): void {
    if (key !== null && this.liveType) {
      this.liveType = { ...this.liveType, selected: key, proposed: false };
      this.set({ typeMenu: this.typeMenuView() });
    }
    this.effects.emit("call:type", { key });
  }

  /** Types by channel: the channel the rep switched to. Shown at once; the dashboard sends back the
   * channel's types (and drops a type of the other channel). A fixed channel never switches. */
  private pickChannel(kind: LiveChannelKind): void {
    const channel = this.liveType?.channel;
    if (!this.liveType || !channel || channel.fixed || channel.selected === kind) return;
    if (!channel.options.some((option) => option.key === kind)) return;
    this.liveType = { ...this.liveType, channel: { ...channel, selected: kind } };
    this.set({ typeMenu: this.typeMenuView() });
    this.effects.emit("call:channel", { kind });
  }

  /** A choice made in the after-call card, sent to the dashboard as it is. */
  private postCallAction(type: string, details: Record<string, unknown>): void {
    this.effects.emit("postcall:action", { ...details, type });
    // These also bring the dashboard forward, like the Swift controller.
    if (type === "review" || type === "openEmail" || type === "notes") this.effects.showMainWindow();
  }

  /** The dashboard moved the call on (written, ready, email drafted...). */
  private postCallChanged(): void {
    switch (this.mode) {
      case "recording":
      case "starting":
      case "call":
      case "stopped":
      case "dialConfirm":
      case "dialing":
        return; // shown once the island is back at rest
      case "finishing": {
        // The card just cleared, or is still the last call's: keep waiting for this one.
        const card = this.current.postCall;
        if (!card || card.memoId === this.finishingAfter) return;
        this.stopTimer("finishTimeout");
        return this.rest();
      }
      case "idle":
        if (this.current.postCall) this.rest();
        return;
      case "postCall": {
        const postCall = this.current.postCall;
        if (!postCall) {
          this.lastPostCallStage = null;
          return this.transition({ kind: "idle" }, false);
        }
        const previous = this.lastPostCallStage;
        this.lastPostCallStage = postCall.stage;
        if (previous === postCall.stage) return; // a row arrived: the card grows in place, a closed island just counts it
        switch (postCall.stage) {
          case "writing":
            // Nothing to decide yet: the closed island's spinner says enough.
            if (this.current.expanded) this.transition({ kind: "postCall" }, false);
            return;
          case "applying":
            this.stopTimer("autoClose");
            this.set({ countdown: null });
            return;
          default:
            return this.rest();
        }
      }
    }
  }

  /* ---------- call detection (from the platform helper) ---------- */

  /** The app now holding the mic, or null when none does. */
  callChanged(caller: Caller | null): void {
    this.currentCaller = caller;
    // Our own call holds the mic: never offer to record it, or anything else, on top of it.
    if (this.vocifyCallUp) return;
    if (caller === null) {
      this.callHandled = false;
      if (this.mode !== "recording" && this.mode !== "starting" && this.mode !== "stopped") this.effects.emit("call:ended", {});
    }
    switch (this.mode) {
      case "recording":
        return this.watchForHangUp(caller);
      case "starting":
      case "stopped":
      case "finishing":
      case "dialing":
        return;
      default: {
        const detected = caller !== null && !this.callHandled && !this.isListening && !this.isQuiet(caller);
        if (detected && caller) {
          const same = this.current.mode.kind === "call" && this.shownCaller?.appId === caller.appId && this.shownCaller?.name === caller.name;
          if (same) return;
          this.shownCaller = caller;
          this.set({ callContact: null });
          // Drops down once to be noticed, then settles beside the camera.
          this.transition({ kind: "call", caller: { name: caller.name, icon: caller.icon ?? null } }, true);
          this.startCountdown(CALL_LINGER);
          this.effects.lookUpCallContact?.(caller);
        } else if (this.mode === "call") {
          this.hide();
        }
      }
    }
  }

  private isQuiet(caller: Caller): boolean {
    return this.quiet !== null && this.effects.now() < this.quiet.until && caller.appId === this.quiet.appId;
  }

  /** Recording a detected call: the call app letting go of the mic ends the recording too. */
  private watchForHangUp(caller: Caller | null): void {
    if (!this.recordingCaller?.appId) return;
    this.stopTimer("hangUp");
    if (caller !== null) return;
    this.start("hangUp", HANG_UP_GRACE, () => {
      if (this.mode === "recording" && this.currentCaller === null) this.stop(true);
    });
  }

  /* ---------- window-facing ---------- */

  setGeometry(geometry: Geometry): void {
    this.set({ geometry });
  }

  /** `mode` and `expanded` change together; any open countdown and its timer end with the old shape. */
  private transition(mode: Mode, expanded: boolean): void {
    this.stopTimer("autoClose");
    this.set({ mode, expanded, countdown: null });
  }
}
