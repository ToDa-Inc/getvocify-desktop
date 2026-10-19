import { decodeDial, decodeOnScreen, isVocifyCallUp } from "../../core/callIsland.ts";
import { decodeMeeting } from "../../core/meetingHeadsUp.ts";
import { LostAudio } from "../../core/islandWording.ts";
import { StopGrace, type StopStep } from "../../core/stopGrace.ts";
import { TypeMenu } from "../../core/typeMenu.ts";
import { TypeProposal, type Language } from "../../core/typeProposal.ts";
import { WaveSide } from "../../core/waveSide.ts";
import type { Assist, Geometry, IslandAction, IslandState, Levels, LiveAction, Mode, PostCallData } from "../../island/src/types.ts";
import { postCallPending } from "../../island/src/types.ts";
import { parseAssist, parseClock, parseContact, parseFinish, parseLiveBrain, parseLiveType, parsePostCall, parseTurns, type LiveChannelKind, type LiveType } from "./parse.ts";

/**
 * The island's brain: what it shows and what each click does. A port of `MeetingPillController` and
 * `MeetingPillState.apply` (MeetingPill.swift), with every side effect injected so it can be tested with a fake clock.
 * Nothing here knows about windows or Electron.
 */

const AFTER_CALL_QUIET = 120;
/** Once the app has let go of the mic the call is over: the next time it holds the mic is a new call, after a short flap. */
const QUIET_AFTER_RELEASE = 5;
const IDLE_LINGER = 5;
/** A meeting's heads-up stays open this long (the pointer on it holds it). */
const MEETING_LINGER = 60;
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
/** How long a call opened on the rep's phone has to connect (its call service taking the mic) before the island says it
 * didn't: the OS asks the rep to confirm first, and the phone needs a moment to reach the computer. */
const PHONE_CONNECT_TIMEOUT = 45;
/** How long the island says a call on the phone didn't connect, or that an ended recording was not kept. */
const PHONE_FAILED_LINGER = 10;
const SKIPPED_LINGER = 4;
/** A call on the phone heard through the PC's sound ends after this long with no call sound and the rep not speaking. */
const CALL_SILENCE = 15;
/** What the island says when the dashboard never took a call, and for how long (s). */
const DIAL_FAILED = "Couldn't start the call";
const DIAL_FAILED_HOLD = 4;
const DIGIT = /^[0-9*#]$/;
/** Waiting on a memo that never came (nothing was said, the upload failed): the dashboard says why in its window, and the island goes back to rest. */
const FINISH_GIVE_UP = 30;

/** The app holding the mic, as detection reports it. */
export type Caller = { name: string | null; appId: string | null; icon?: string | null; /** Every call app on the mic (absent: just `appId`). */ holding?: string[] };

/** The services a call on the rep's iPhone runs its audio in (FaceTime places and answers them on the Mac). */
const PHONE_CALL_SERVICES = ["com.apple.avconferenced", "com.apple.FaceTime"];

/** Whether `appId` is among the apps on the mic. A platform that does not list them all (Windows) says "yes" for any app. */
function holds(caller: Caller | null, appId: string | null): boolean {
  if (caller === null || appId === null) return false;
  return caller.holding ? caller.holding.includes(appId) : true;
}

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
  /** One line for the log (optional): why a call was or was not offered. */
  log?(line: string): void;
  /** Recording without a detected call: name the app holding the mic, if any (never asks for browser access). */
  lookUpCallSource?(caller: Caller | null): void;
  /** A call was detected: read the CRM page on screen and the call source. */
  lookUpCallContact?(caller: Caller | null): void;
  /** Opens a web link in the default browser (a meeting's call link). */
  openExternal?(url: string): void;
  /** Where a call on the phone is heard through the PC's sound, not seen on the mic (Windows): listen for it while the
   * island waits; `onSound` once it plays. Absent where the mic shows the call (Mac). */
  watchCallSound?(onSound: () => void): void;
  stopCallSound?(): void;
};

type Timers = "autoClose" | "startTimeout" | "hangUp" | "finishTimeout" | "dialTimeout" | "dialFailedHold" | "phoneConnect" | "callSilence" | "typeNote";

export class IslandController {
  private effects: Effects;
  private current: IslandState;
  /** Everything the dashboard has pushed, key by key (`listening` is read from here). */
  private shell: Record<string, unknown> = {};
  private liveType: LiveType | null = null;
  /** Which type is Vocify's and which the rep's, and the line that announces a change. */
  private proposal = new TypeProposal();
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
  /** Recording a call on the phone that started on its sound: silence on both sides is its hang-up. */
  private soundCall = false;
  /** Meetings already announced: each opens the island once. */
  private announcedMeetings = new Set<string>();
  /** One meeting at one time: a meeting moved to another time is announced (and can be closed) again. */
  private static occasion(meeting: { id: string; startsAt: number }): string {
    return `${meeting.id}@${meeting.startsAt}`;
  }
  /** The meeting the rep closed: not shown again. */
  private dismissedMeeting: string | null = null;
  /** True when a native recorder draws the transcript itself; the dashboard's overlay then must not overwrite it. */
  nativeTranscript = false;

  constructor(effects: Effects, geometry: Geometry, options: { recorderReady?: boolean; material: IslandState["material"]; reduceMotion: boolean; language?: Language; placement?: "notch" | "side" }) {
    this.effects = effects;
    this.current = {
      mode: { kind: "idle" },
      expanded: false,
      paused: false,
      recorderReady: options.recorderReady ?? false,
      callAudioLost: false,
      micSilent: false,
      callContact: null,
      clock: null,
      levels: { you: 0, them: 0, side: "them", at: effects.now() },
      turns: [],
      assist: null,
      lastHelp: null,
      typeMenu: null,
      liveHelp: null,
      live: null,
      liveTab: "transcript",
      placement: options.placement ?? "notch",
      countdown: null,
      geometry,
      postCall: null,
      finish: null,
      onScreen: null,
      dial: null,
      meeting: null,
      crmBlocked: null,
      keypadOpen: false,
      material: options.material,
      reduceMotion: options.reduceMotion,
      language: options.language ?? "en",
    };
  }

  get state(): IslandState {
    return this.current;
  }

  /** Recording a call on the phone that ends on silence (Windows): its per-second activity is worth the log. */
  get endsOnSilence(): boolean {
    return this.soundCall && (this.mode === "recording" || this.mode === "stopped");
  }

  /** The app the call being recorded happens in (what Record was pressed on, else what holds the mic). */
  get recordingAppId(): string | null {
    return this.recordingCaller?.appId ?? this.currentCaller?.appId ?? null;
  }

  /** The browser in front macOS won't let Vocify read (its name), or null once one is read again. */
  setCrmBlocked(browser: string | null): void {
    if ((this.current.crmBlocked?.browser ?? null) === browser) return;
    this.set({ crmBlocked: browser ? { browser } : null });
  }

  /** The dashboard says it is recording (`shell:state` listening). */
  get isListening(): boolean {
    return this.shell.listening === true;
  }

  private set(patch: Partial<IslandState>): void {
    this.current = { ...this.current, ...patch };
    // A type Vocify changed while the island was closed waits: its line is on show for a few seconds once it is open.
    if (this.proposal.note && this.current.expanded && !this.cancels.has("typeNote")) {
      this.start("typeNote", TypeProposal.noteSeconds, () => this.typeNoteEnded());
    }
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
    if (typeof update.micSilent === "boolean" && update.micSilent !== this.current.micSilent) {
      // Opens the island the same way: a recording that hears nothing must say so even with the dashboard hidden.
      audioChange ??= [this.current.micSilent, update.micSilent];
      patch.micSilent = update.micSilent;
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
    if ((update.language === "es" || update.language === "en") && update.language !== this.current.language) patch.language = update.language;
    if (typeof update.liveHelp === "boolean" && update.liveHelp !== this.current.liveHelp) patch.liveHelp = update.liveHelp;
    if (has("liveBrain")) {
      const next = parseLiveBrain(update.liveBrain);
      if (JSON.stringify(next) !== JSON.stringify(this.current.live)) patch.live = next;
    }
    if (has("liveType")) {
      const next = parseLiveType(update.liveType);
      if (JSON.stringify(next) !== JSON.stringify(this.liveType)) {
        this.liveType = next;
        const note = next ? this.proposal.hear(next.selected, next.proposed) : (this.proposal.reset(), null);
        // A new note gets its own full time (set() starts it once the island is open); a gone one has nothing to time.
        if (note || !this.proposal.note) this.stopTimer("typeNote");
        patch.typeMenu = this.typeMenuView();
      }
    }
    let meetingChanged = false;
    if (has("meeting")) {
      const decoded = decodeMeeting(update.meeting);
      const next = decoded && IslandController.occasion(decoded) === this.dismissedMeeting ? null : decoded;
      if (JSON.stringify(next) !== JSON.stringify(this.current.meeting)) {
        patch.meeting = next;
        meetingChanged = true;
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
    if (update.callActivity !== undefined) this.callActivity(update.callActivity);
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
    if (meetingChanged) this.meetingChanged();
  }

  /** A meeting is about to start: the resting island opens once to say who it is with.
   * Busy (a call, a recording), it is not interrupted: it is announced as soon as the island is back at rest. */
  private meetingChanged(): void {
    const meeting = this.current.meeting;
    if (!meeting || this.mode !== "idle" || this.announcedMeetings.has(IslandController.occasion(meeting))) return;
    this.announcedMeetings.add(IslandController.occasion(meeting));
    this.transition({ kind: "idle" }, true);
    this.startCountdown(MEETING_LINGER);
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
    const noted = this.proposal.note;
    const label = noted && this.liveType.options.find((option) => option.key === noted.key)?.label;
    const note = noted && label ? { id: noted.id, kind: noted.kind, label } : null;
    return { title, placeholder: menu.placeholder, proposed: menu.placeholder ? false : this.liveType.proposed, rows: menu.rows, channel, note };
  }

  private typeNoteEnded(): void {
    this.proposal.expire();
    if (this.liveType) this.set({ typeMenu: this.typeMenuView() });
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
      case "dismissFinish":
        return this.dismissFinish();
      case "pickCallType":
        return this.pickCallType(action.key);
      case "undoCallType":
        return this.undoCallType();
      case "pickChannel":
        return this.pickChannel(action.kind);
      case "toggleLiveHelp":
        return this.effects.emit("shell:command", this.current.liveHelp === false ? "assist-on" : "assist-off");
      case "postCall":
        return this.postCallAction(action.type, action.details ?? {});
      case "liveTab":
      case "liveAsk":
      case "liveTick":
      case "liveDismiss":
      case "liveRewrite":
      case "liveAskStep":
      case "liveRespondTurn":
      case "liveEvent":
        return this.liveAction(action);
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
      case "cancelPhoneCall":
        return this.endPhoneCall(false);
      case "setUpPhone":
        return this.endPhoneCall(true);
      case "joinMeeting":
        if (this.current.meeting?.url) this.effects.openExternal?.(this.current.meeting.url);
        return this.collapse();
      case "dismissMeeting":
        this.dismissedMeeting = this.current.meeting ? IslandController.occasion(this.current.meeting) : null;
        this.set({ meeting: null });
        return this.collapse();
      case "fixCrmAccess":
        // The dashboard shows how to allow it (its permission card opens the exact System Settings page).
        this.collapse();
        this.effects.showMainWindow();
        return this.effects.emit("shell:command", "open-crm-access");
    }
  }

  /* ---------- calling the CRM contact on screen ---------- */

  /** The phone beside the mark: who would be called, and from which number. */
  private openDialConfirm(): void {
    // Also from a detected call that is not being recorded: an app holding the mic does not stop the rep calling a contact.
    if ((this.mode !== "idle" && this.mode !== "call") || !this.current.onScreen) return;
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
      // The dashboard never took the call.
      if (this.mode === "dialing" && this.current.dial === null) this.dialFailed(DIAL_FAILED);
    });
  }

  /** Says why the call did not start, where the rep clicked, for a moment. Never opens the dashboard for it. */
  private dialFailed(message: string): void {
    this.stopTimer("dialTimeout");
    const offer = this.current.onScreen;
    this.set({ dial: { phase: "ended", name: offer?.name ?? null, phone: offer?.phone ?? "", answeredAt: null, muted: false, message, brief: null, companyBrief: null } });
    this.start("dialFailedHold", DIAL_FAILED_HOLD, () => {
      if (this.mode !== "dialing" || this.current.dial?.message !== message) return;
      this.set({ dial: null });
      this.rest();
    });
  }

  /** The call is open in the rep's phone app (Vocify calling off): the island waits for it to connect. */
  phoneDialed(): void {
    if (this.mode !== "dialing" || this.current.dial !== null) return;
    this.stopTimer("dialTimeout");
    this.transition({ kind: "phoneCall", name: this.current.onScreen?.name ?? null, failed: false }, true);
    this.effects.watchCallSound?.(() => this.callSoundHeard());
    this.start("phoneConnect", PHONE_CONNECT_TIMEOUT, () => {
      if (this.current.mode.kind !== "phoneCall" || this.current.mode.failed) return;
      this.effects.stopCallSound?.();
      // Never connected: the rep cancelled the OS's confirm, or calls from the phone aren't set up on this computer.
      this.effects.emit("call:ended", {});
      this.transition({ ...this.current.mode, failed: true }, true);
      this.startCountdown(PHONE_FAILED_LINGER);
    });
  }

  /** The call on the phone played through the PC (its ring or the other side): it is recorded, and silence on both
   * sides ends it (see `callActivity`). */
  private callSoundHeard(): void {
    if (this.current.mode.kind !== "phoneCall" || this.current.mode.failed) return;
    this.soundCall = true;
    this.phoneConnected(null);
  }

  /** The call on the phone connected: its call service took the mic (its letting go is the hang-up), or its sound played. */
  private phoneConnected(caller: Caller | null): void {
    this.stopTimer("phoneConnect");
    // Seen on the mic: the sound is not needed. Heard: its capture goes on as the recording's.
    if (caller) this.effects.stopCallSound?.();
    this.recordingCaller = caller;
    this.transition({ kind: "starting" }, false);
    this.effects.emit("shell:command", "listen");
    this.start("startTimeout", START_TIMEOUT, () => {
      if (this.mode !== "starting") return;
      this.rest();
      this.effects.showMainWindow();
    });
  }

  /** Stops waiting for the call on the phone (Cancel), or sends the rep to set it up (it never connected). */
  private endPhoneCall(setUp: boolean): void {
    if (this.current.mode.kind !== "phoneCall") return;
    const failed = this.current.mode.failed;
    this.stopTimer("phoneConnect");
    if (!failed) this.effects.stopCallSound?.();
    if (!failed) this.effects.emit("call:ended", {});
    this.rest();
    if (setUp) this.effects.emit("shell:command", "open-phone-setup");
  }

  /** The rep's phone app could not open the call (`message` says why, in the rep's words). */
  phoneDialFailed(message: string): void {
    if (this.mode === "dialing" && this.current.dial === null) this.dialFailed(message);
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
        // Answered: from here on the island is the call's live view, not a bar waiting for the dashboard.
        if (dial?.phase === "active") this.show();
        return;
      case "dialing":
        if (dial?.phase === "active") return this.show();
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
        if (this.current.finish?.step === "failed" && expanded) return this.dismissFinish();
        return this.transition(mode, !expanded);
      case "dialConfirm":
        return this.leaveDialConfirm();
      case "dialing":
        return this.transition(mode, !expanded);
      case "phoneCall":
        // A call that never connected is over once its card closes.
        if (mode.failed && expanded) return this.endPhoneCall(false);
        return this.transition(mode, !expanded);
      case "starting":
      case "stopped":
        return;
    }
  }

  collapse(): void {
    // The confirm row is only ever open: closing it is going back to rest.
    if (this.mode === "dialConfirm") this.leaveDialConfirm();
    else if (this.current.mode.kind === "phoneCall" && this.current.mode.failed) this.endPhoneCall(false);
    else if (this.current.expanded) this.transition(this.current.mode, false);
  }

  /** Back from the confirm row: to the call offer it was opened from while that app still holds the mic, else to rest. */
  private leaveDialConfirm(): void {
    const caller = this.currentCaller;
    if (caller && !this.callHandled && !this.isListening && !this.isQuiet(caller)) {
      this.transition({ kind: "call", caller: { name: caller.name, icon: caller.icon ?? null } }, false);
    } else {
      this.transition({ kind: "idle" }, false);
    }
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

  /** The dashboard's reading of the last second: the call side played sound, the rep spoke. Either keeps a call on the
   * phone heard through the PC's sound going. */
  private callActivity(raw: unknown): void {
    if (!this.soundCall || this.mode !== "recording" || typeof raw !== "object" || raw === null) return;
    const { them, you } = raw as { them?: unknown; you?: unknown };
    if (them === true || you === true) this.start("callSilence", CALL_SILENCE, () => this.callWentSilent());
  }

  /** The call on the phone stopped playing in its audio session (Windows): its hang-up, with a call app's grace. */
  callAudioEnded(): void {
    if (!this.soundCall || this.mode !== "recording") return;
    this.start("hangUp", HANG_UP_GRACE, () => {
      if (this.soundCall && this.mode === "recording") this.stop(true);
    });
  }

  /** It played again within the grace: a dropout, not a hang-up. */
  callAudioBack(): void {
    if (this.soundCall) this.stopTimer("hangUp");
  }

  private callWentSilent(): void {
    if (!this.soundCall || this.mode !== "recording") return;
    // Paused, nothing is measured: the silence says nothing about the call.
    if (this.current.paused) return this.start("callSilence", CALL_SILENCE, () => this.callWentSilent());
    this.stop(true);
  }

  /** Pauses, says so with Resume, and ends once the grace runs out (see StopGrace). */
  stop(byHangUp: boolean): void {
    if (this.mode !== "recording") return;
    this.stopTimer("hangUp");
    this.stopTimer("callSilence");
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
    if (this.soundCall) this.start("callSilence", CALL_SILENCE, () => this.callWentSilent());
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
    // The confirm row offers Record next to Call, as the open island at rest does.
    if (previous.kind !== "idle" && previous.kind !== "call" && previous.kind !== "dialConfirm") return;
    if (!this.current.recorderReady) return this.effects.showMainWindow();
    if (previous.kind === "call") this.recordingCaller = this.shownCaller;
    else this.effects.lookUpCallSource?.(this.currentCaller);
    this.transition({ kind: "starting" }, false);
    this.effects.emit("shell:command", "listen");
    this.start("startTimeout", START_TIMEOUT, () => {
      if (this.mode !== "starting") return;
      this.transition(previous.kind === "dialConfirm" ? { kind: "idle" } : previous, false);
      this.effects.showMainWindow();
    });
  }

  /** The dashboard started recording (`overlay:show`), from the island or from its own button; an answered Vocify call
   * counts from the answer itself, so the transcript view is there before the live session has started. */
  show(): void {
    // Only a call app already holding the mic is the one being handled (until it lets go). A recording that is not a detected
    // call (a Vocify call, a meeting) must not hide the next call app from the island.
    this.callHandled = this.currentCaller !== null;
    this.stopTimer("startTimeout");
    // The dashboard ends a Vocify call; another app letting go of the mic says nothing about it.
    if (this.vocifyCallUp) this.recordingCaller = null;
    else if (this.current.mode.kind === "call") this.recordingCaller = this.shownCaller;
    // Started from the island's offer: the call it named is the one to follow, even if it already let go of the mic.
    else if (this.mode !== "recording" && this.mode !== "starting") this.recordingCaller = this.currentCaller;
    // The call the rep placed from the island stays as open (or closed) as they had it when it is answered.
    const keepsShape = this.mode === "recording" || (this.mode === "dialing" && this.vocifyCallUp);
    this.transition({ kind: "recording" }, keepsShape && this.current.expanded);
    // The call app let go of the mic while the recording was still starting: nothing else will say so, so the hang-up is watched now.
    if (this.recordingCaller?.appId && !holds(this.currentCaller, this.recordingCaller.appId)) this.watchForHangUp(this.currentCaller);
    if (this.soundCall) this.start("callSilence", CALL_SILENCE, () => this.callWentSilent());
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
      // The mic already let go (a hang-up): that call is over. Held still (the rep stopped it by hand): dialers grab it again.
      const seconds = this.currentCaller === null ? QUIET_AFTER_RELEASE : AFTER_CALL_QUIET;
      this.quiet = { appId: this.recordingCaller.appId, until: this.effects.now() + seconds * 1000 };
    }
    this.recordingCaller = null;
    // The call on the phone is over: stop following its sound and audio session.
    if (this.soundCall) this.effects.stopCallSound?.();
    this.soundCall = false;
    this.stopTimer("callSilence");
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
      if (this.mode !== "finishing") return;
      this.rest();
      // A call app that took the mic while the island waited for the memo was ignored then, and nothing reports it again.
      if ((this.mode as string) === "idle" && this.currentCaller && !this.callHandled && !this.isListening && !this.isQuiet(this.currentCaller)) this.callChanged(this.currentCaller);
    });
  }

  /** The rep closes the card that says the ended recording failed (the dashboard has already kept what it could). */
  private dismissFinish(): void {
    if (this.mode !== "finishing" || this.current.finish?.step !== "failed") return;
    this.stopTimer("finishTimeout");
    this.rest();
  }

  /** The dashboard says how the ended recording is going: a failure opens the island and stays; a recording it did not
   * keep (an unanswered call) says why for a moment. */
  private finishChanged(): void {
    if (this.mode === "finishing" && this.current.finish?.step === "skipped") {
      this.stopTimer("finishTimeout");
      this.transition({ kind: "finishing" }, true);
      this.start("finishTimeout", SKIPPED_LINGER, () => {
        if (this.mode === "finishing" && this.current.finish?.step === "skipped") {
          this.set({ finish: null });
          this.rest();
        }
      });
      return;
    }
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
    this.proposal.pick(key);
    this.stopTimer("typeNote");
    if (key !== null && this.liveType) this.liveType = { ...this.liveType, selected: key, proposed: false };
    if (this.liveType) this.set({ typeMenu: this.typeMenuView() });
    this.effects.emit("call:type", { key });
  }

  /** Undo on a change Vocify made: the type before, sent as the rep's own pick, so Vocify proposes no more. */
  private undoCallType(): void {
    const key = this.proposal.undo();
    if (key === null) return;
    this.pickCallType(key);
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
    if (type === "review" || type === "openEmail" || type === "openNotes" || type === "notes" || type === "chooseContact") this.effects.showMainWindow();
    // The updated record opens in the browser, never in Vocify's window (only a web link reaches here: see parse).
    if (type === "openCrm" && this.current.postCall?.crmUrl) this.effects.openExternal?.(this.current.postCall.crmUrl);
    // The card closes here, not when the dashboard answers: a page that was signed out, reloaded or closed since the
    // call never answers, and the card would stay on screen with nothing able to close it.
    if (type === "dismiss" && this.current.postCall) {
      this.lastPostCallStage = null;
      this.set({ postCall: null });
      if (this.mode === "postCall") this.transition({ kind: "idle" }, false);
    }
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
    if (this.vocifyCallUp) {
      if (caller) this.effects.log?.("call offer: not offered (a Vocify call is up)");
      return;
    }
    if (caller !== null && this.mode !== "idle" && this.mode !== "call" && this.mode !== "postCall") this.effects.log?.(`call offer: not offered (island is ${this.mode})`);
    if (caller === null) {
      this.callHandled = false;
      // The app let go of the mic: that call is over, so the same app holding it again is a new call, not the old one's tail.
      if (this.quiet) this.quiet.until = Math.min(this.quiet.until, this.effects.now() + QUIET_AFTER_RELEASE * 1000);
      if (this.mode !== "recording" && this.mode !== "starting" && this.mode !== "stopped") this.effects.emit("call:ended", {});
    }
    switch (this.mode) {
      case "recording":
        return this.watchForHangUp(caller);
      case "phoneCall":
        // The first call app to take the mic while the island waits is the call on the phone.
        if (caller && this.current.mode.kind === "phoneCall" && !this.current.mode.failed) {
          // Where the call is not heard through the PC's sound, the call service taking the mic is the call. Any other app
          // on the mic (WhatsApp sitting on it, a browser) is not: recording then began when Call was pressed.
          const service = this.effects.watchCallSound ? caller : (PHONE_CALL_SERVICES.find((id) => holds(caller, id)) ?? null);
          if (typeof service === "string") this.phoneConnected({ name: "FaceTime", appId: service });
          else if (service) this.phoneConnected(service);
        }
        return;
      case "starting":
      case "stopped":
      case "finishing":
      case "dialing":
        return;
      default: {
        const detected = caller !== null && !this.callHandled && !this.isListening && !this.isQuiet(caller);
        if (caller) this.effects.log?.(`call offer: ${detected ? "offered" : `not offered (${this.callHandled ? "already handled" : this.isListening ? "already recording" : "just recorded"})`}`);
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
    // Its own app letting go is the hang-up, whichever other apps still hold the mic.
    if (holds(caller, this.recordingCaller.appId)) return;
    this.start("hangUp", HANG_UP_GRACE, () => {
      if (this.mode === "recording" && !holds(this.currentCaller, this.recordingCaller?.appId ?? null)) this.stop(true);
    });
  }

  /* ---------- window-facing ---------- */

  setGeometry(geometry: Geometry): void {
    this.set({ geometry });
  }

  /** `mode` and `expanded` change together; any open countdown and its timer end with the old shape. */
  /** The live assistant's asks and marks go to the dashboard (`livebrain:action`), which owns its state; the open tab stays
   * here too, because the island's height follows it. */
  private liveAction(action: LiveAction): void {
    if (this.mode !== "recording" || !this.current.live) return;
    switch (action.name) {
      case "liveTab":
        if (action.tab !== this.current.liveTab) this.set({ liveTab: action.tab });
        return this.effects.emit("livebrain:action", { type: "tab", tab: action.tab });
      case "liveAsk":
        return this.effects.emit("livebrain:action", { type: action.ask === "respond" ? "responder" : action.ask === "now" ? "preguntar" : "resumen" });
      case "liveTick":
        return this.effects.emit("livebrain:action", { type: action.on ? "tick" : "untick", id: action.id, kind: action.kind });
      case "liveDismiss":
        return this.effects.emit("livebrain:action", { type: "dismiss", id: action.id });
      case "liveRewrite":
        return this.effects.emit("livebrain:action", { type: "rewrite", id: action.id, version: action.version });
      case "liveAskStep":
        return this.effects.emit("livebrain:action", { type: "ask_step", kind: action.kind, id: action.id });
      case "liveRespondTurn":
        return this.effects.emit("livebrain:action", { type: "responder_turn", turn_id: action.turnId });
      case "liveEvent":
        return this.effects.emit("livebrain:action", { type: "event", kind: action.event, ...(action.id ? { id: action.id } : {}) });
    }
  }

  /** Where the recording sits (the desktop setting): the window follows it. */
  setPlacement(placement: "notch" | "side"): void {
    if (placement !== this.current.placement) this.set({ placement });
  }

  private transition(mode: Mode, expanded: boolean): void {
    this.stopTimer("autoClose");
    // Every recording starts on its transcript.
    this.set({ mode, expanded, countdown: null, ...(mode.kind !== "recording" && this.current.liveTab !== "transcript" ? { liveTab: "transcript" as const } : {}) });
    // A meeting that came up while a call, a recording or a card held the island is announced once it is back at rest.
    if (mode.kind === "idle" && !expanded) this.meetingChanged();
  }
}
