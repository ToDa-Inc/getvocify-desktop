import { StopGrace } from "../../core/stopGrace.ts";
import { TypeMenu } from "../../core/typeMenu.ts";
import { WaveSide } from "../../core/waveSide.ts";
import type { Assist, Geometry, IslandAction, IslandState, PostCallData, Turn } from "../../island/src/types.ts";

/**
 * Drives the island with scripted calls, so every state can be tried by hand before the real recorder,
 * call detection and dashboard are wired in. Behaviour follows MeetingPillController in MeetingPill.swift;
 * the after-call card is not ported yet, so the post-call stage only shows its closed states.
 */

const IDLE_LINGER = 5;
const CALL_LINGER = 8;
const MIN_HOLD_AFTER_LEAVE = 1.5;

const OPTIONS = [
  { key: "discovery", label: "Discovery call" },
  { key: "demo", label: "Demo" },
  { key: "follow_up", label: "Follow-up" },
  { key: "internal", label: "Internal" },
];

const SCRIPT: { you: boolean; label: string | null; text: string }[] = [
  { you: true, label: null, text: "Hi Marta, thanks for making time today. How is the quarter going?" },
  { you: false, label: "Marta Ruiz", text: "Busy, honestly. We are still deciding whether to move the whole team off the old CRM before the summer." },
  { you: true, label: null, text: "That is exactly what I wanted to dig into. What is the main blocker today?" },
  { you: false, label: "Marta Ruiz", text: "Mainly price. Pues, también nos preocupa la migración de los datos y quién lo va a hacer." },
  { you: true, label: null, text: "Understood. We can cover the migration for you, and I can show how other teams recovered the cost." },
  { you: false, label: "Marta Ruiz", text: "And how long would that take, realistically? We cannot be offline for more than a day." },
  { you: true, label: null, text: "Most teams are live within a week and never lose a day of work." },
];

const postCallData = (stage: PostCallData["stage"], extra: Partial<PostCallData> = {}): PostCallData => ({
  stage, memoId: "demo-memo", contactName: "Marta Ruiz", changes: [], canApprove: false, applied: null, undoUntil: null, note: null,
  email: null, meeting: null, notes: false, summary: null, crm: "HubSpot", offerStopEmails: false, type: null, ...extra,
});

const ANSWER: Assist = {
  label: "Price objection",
  isQuestion: false,
  drafting: false,
  bridge: "That is a fair concern, let me put it in context.",
  sayThis: "Most teams recover the cost in the first quarter because reps stop doing manual CRM updates. Want me to show the numbers for a team your size?",
  thenAsk: "How many reps would use it?",
};

type Timer = ReturnType<typeof setTimeout>;

export class DemoController {
  state: IslandState;
  private listeners = new Set<(state: IslandState) => void>();
  private levelListeners = new Set<(levels: IslandState["levels"]) => void>();
  private log: (line: string) => void;
  private timers = new Map<string, Timer>();
  private pointerInside = false;
  private grace: StopGrace | null = null;
  private scriptIndex = 0;
  private typeSelected: string | null = "discovery";
  private typeProposed = true;
  private callerName: string | null = null;

  constructor(geometry: Geometry, material: IslandState["material"], reduceMotion: boolean, log: (line: string) => void = console.log) {
    this.log = log;
    this.state = {
      mode: { kind: "idle" },
      expanded: false,
      paused: false,
      recorderReady: true,
      callAudioLost: false,
      callContact: null,
      clock: null,
      levels: { you: 0, them: 0, side: "them", at: Date.now() },
      turns: [],
      assist: null,
      lastHelp: null,
      typeMenu: null,
      liveHelp: null,
      countdown: null,
      geometry,
      postCall: null,
      material,
      reduceMotion,
    };
  }

  subscribe(listener: (state: IslandState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Voice levels change ten times a second: they take their own channel and never cause a full state render. */
  subscribeLevels(listener: (levels: IslandState["levels"]) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  private set(patch: Partial<IslandState>): void {
    this.state = { ...this.state, ...patch };
    const keys = Object.keys(patch);
    if (keys.length === 1 && keys[0] === "levels") {
      for (const listener of this.levelListeners) listener(this.state.levels);
      return;
    }
    for (const listener of this.listeners) listener(this.state);
  }

  private after(name: string, seconds: number, run: () => void): void {
    this.cancel(name);
    this.timers.set(name, setTimeout(() => { this.timers.delete(name); run(); }, seconds * 1000));
  }

  private cancel(name: string): void {
    const timer = this.timers.get(name);
    if (timer) clearTimeout(timer);
    this.timers.delete(name);
  }

  /* ---------- the island's own actions ---------- */

  act(action: IslandAction): void {
    const kind = this.state.mode.kind;
    switch (action.name) {
      case "toggle":
        this.toggle();
        break;
      case "pointer":
        this.pointer(action.inside);
        break;
      case "record":
        if (!this.state.recorderReady) this.log("Signed out: the real app opens Vocify to sign in.");
        else if (kind === "idle" || kind === "call") this.startRecording();
        break;
      case "dismissCall":
        this.callerName = null;
        this.set({ callContact: null });
        this.collapseTo({ kind: "idle" });
        break;
      case "openApp":
        this.log("Open Vocify: the real app brings the dashboard window forward.");
        break;
      case "togglePause":
        if (kind === "recording") this.setPaused(!this.state.paused);
        break;
      case "stop":
        if (kind === "recording") this.stop(false);
        break;
      case "resume":
        if (kind === "stopped") this.resume();
        break;
      case "pickCallType":
        this.typeSelected = action.key ?? this.typeSelected;
        this.typeProposed = action.key === null;
        this.set({ typeMenu: this.buildTypeMenu() });
        this.log(action.key === null ? "Call type handed back to Vocify." : `Call type picked: ${action.key}`);
        break;
      case "toggleLiveHelp":
        if (this.state.liveHelp !== null) this.set({ liveHelp: !this.state.liveHelp });
        break;
    }
  }

  private toggle(): void {
    const { mode, expanded } = this.state;
    switch (mode.kind) {
      case "recording":
        this.setExpanded(!expanded);
        break;
      case "idle":
      case "call":
        this.setExpanded(!expanded);
        if (!expanded) this.startCountdown(mode.kind === "idle" ? IDLE_LINGER : CALL_LINGER, () => this.setExpanded(false));
        break;
      case "postCall":
        this.log("The after-call card is not ported yet.");
        break;
      default:
        break;
    }
  }

  private setExpanded(expanded: boolean): void {
    this.cancel("countdown");
    this.set({ expanded, countdown: null });
  }

  private collapseTo(mode: IslandState["mode"]): void {
    this.cancel("countdown");
    this.set({ mode, expanded: false, countdown: null });
  }

  private startCountdown(total: number, finish: () => void): void {
    this.set({ countdown: { total, remaining: total, runningSince: Date.now() } });
    this.after("countdown", total, finish);
    this.finishCountdown = finish;
  }

  private finishCountdown: () => void = () => {};

  /** The pointer holds a self-closing card open; leaving lets the line run out again, never snapping shut. */
  private pointer(inside: boolean): void {
    this.pointerInside = inside;
    const countdown = this.state.countdown;
    if (!countdown || !this.state.expanded) return;
    const now = Date.now();
    if (inside && countdown.runningSince !== null) {
      this.cancel("countdown");
      this.set({ countdown: { ...countdown, remaining: countdown.remaining - (now - countdown.runningSince) / 1000, runningSince: null } });
    } else if (!inside && countdown.runningSince === null) {
      const remaining = Math.max(countdown.remaining, MIN_HOLD_AFTER_LEAVE);
      this.set({ countdown: { ...countdown, remaining, runningSince: now } });
      this.after("countdown", remaining, this.finishCountdown);
    }
  }

  /* ---------- recording ---------- */

  private buildTypeMenu() {
    return new TypeMenu(OPTIONS, this.typeSelected, this.typeProposed);
  }

  private typeMenuView() {
    const menu = this.buildTypeMenu();
    return { title: menu.title, placeholder: menu.placeholder, sparkle: menu.sparkle, rows: menu.rows };
  }

  private startRecording(): void {
    this.cancel("countdown");
    this.set({ mode: { kind: "starting" }, expanded: false, countdown: null });
    this.after("starting", 0.7, () => {
      const now = Date.now();
      this.scriptIndex = 0;
      this.typeSelected = "discovery";
      this.typeProposed = true;
      this.set({
        mode: { kind: "recording" },
        expanded: false,
        paused: false,
        clock: { startedAt: now, pausedMs: 0, pausedAt: null },
        turns: [],
        assist: null,
        lastHelp: null,
        liveHelp: true,
        typeMenu: this.typeMenuView(),
        levels: { you: 0, them: 0, side: "them", at: now },
      });
      this.log("Recording (simulated): a scripted conversation streams into the island.");
      this.after("line", 1.2, () => this.nextLine());
    });
  }

  private nextLine(): void {
    if (this.state.mode.kind !== "recording") return;
    if (this.state.paused) return void this.after("line", 0.5, () => this.nextLine());
    const line = SCRIPT[this.scriptIndex % SCRIPT.length];
    const id = `turn-${this.scriptIndex}`;
    this.scriptIndex += 1;
    const words = line.text.split(" ");
    let shown = 0;
    const step = () => {
      if (this.state.mode.kind !== "recording") return;
      if (this.state.paused) return void this.after("words", 0.3, step);
      shown = Math.min(words.length, shown + 1);
      const settled = Math.max(0, shown - 3);
      const done = shown >= words.length;
      const turn: Turn = {
        id,
        you: line.you,
        label: line.label,
        text: words.slice(0, done ? words.length : settled).join(" "),
        pending: done ? "" : words.slice(settled, shown).join(" "),
      };
      const turns = this.state.turns.some((t) => t.id === id)
        ? this.state.turns.map((t) => (t.id === id ? turn : t))
        : [...this.state.turns, turn];
      const level = 0.35 + Math.random() * 0.4;
      const you = line.you ? level : 0;
      const them = line.you ? 0 : level;
      this.set({
        turns,
        levels: { you, them, side: WaveSide.next(you, them, this.state.levels.side), at: Date.now() },
      });
      if (done) {
        this.set({ levels: { ...this.state.levels, you: 0, them: 0, at: Date.now() } });
        this.after("line", 1.1, () => this.nextLine());
      } else {
        this.after("words", 0.26, step);
      }
    };
    step();
  }

  private setPaused(paused: boolean): void {
    const clock = this.state.clock;
    if (!clock || paused === this.state.paused) return;
    const now = Date.now();
    this.set({
      paused,
      clock: paused ? { ...clock, pausedAt: now } : { ...clock, pausedMs: clock.pausedMs + (clock.pausedAt ? now - clock.pausedAt : 0), pausedAt: null },
    });
  }

  private stop(byHangUp: boolean): void {
    const grace = new StopGrace(byHangUp, this.state.paused);
    this.grace = grace;
    if (grace.onStop.includes("pause")) this.setPaused(true);
    this.cancel("line");
    this.cancel("words");
    this.cancel("countdown");
    this.set({ mode: { kind: "stopped", title: grace.title }, expanded: true, countdown: null });
    if (grace.immediate) return this.finishStop();
    this.startCountdown(StopGrace.seconds, () => this.finishStop());
  }

  private resume(): void {
    const grace = this.grace;
    this.grace = null;
    this.cancel("countdown");
    if (grace?.onResume.includes("resume")) this.setPaused(false);
    this.set({ mode: { kind: "recording" }, expanded: true, countdown: null });
    this.after("line", 0.6, () => this.nextLine());
  }

  private finishStop(): void {
    this.grace = null;
    this.cancel("countdown");
    this.set({ mode: { kind: "postCall" }, expanded: false, countdown: null, postCall: postCallData("writing") });
    this.log("Call over: the memo is written, then the CRM update (closed states only; the card is not ported).");
    this.after("post", 2.5, () => {
      this.set({ postCall: postCallData("ready", { email: { state: "ready", to: null, subject: null, preview: null }, meeting: { state: "pending", when: null } }) });
      this.after("post", 6, () => {
        this.set({ postCall: postCallData("done", { applied: 4 }) });
        this.after("post", 3, () => this.reset());
      });
    });
  }

  /* ---------- commands from the control window ---------- */

  command(name: string): void {
    const { mode } = this.state;
    switch (name) {
      case "call:zoom":
      case "call:chrome": {
        if (mode.kind !== "idle") return this.log("Finish or reset the current state first.");
        this.callerName = name === "call:zoom" ? "Zoom" : "Google Chrome";
        this.set({ mode: { kind: "call", caller: { name: this.callerName } }, expanded: false });
        this.log(`${this.callerName} is using the mic: the island offers Record.`);
        break;
      }
      case "contact:toggle":
        this.set({ callContact: this.state.callContact ? null : "Marta Ruiz · Acme Logistics" });
        break;
      case "hangup":
        if (mode.kind === "recording") this.stop(true);
        else if (mode.kind === "call") this.collapseTo({ kind: "idle" });
        break;
      case "signedout:toggle":
        this.set({ recorderReady: !this.state.recorderReady });
        break;
      case "audiolost:toggle":
        if (mode.kind === "recording") this.set({ callAudioLost: !this.state.callAudioLost });
        break;
      case "help:show":
        if (mode.kind !== "recording") return this.log("Start recording first.");
        this.set({ assist: { ...ANSWER, drafting: true, sayThis: "" } });
        this.after("help", 1.6, () => this.set({ assist: ANSWER }));
        break;
      case "help:clear":
        this.cancel("help");
        this.set({ lastHelp: this.state.assist && !this.state.assist.drafting ? this.state.assist : this.state.lastHelp, assist: null });
        break;
      case "material:toggle":
        this.set({ material: this.state.material === "vibrancy" ? "opaque" : "vibrancy" });
        break;
      case "reset":
        this.reset();
        break;
    }
  }

  reset(): void {
    for (const name of [...this.timers.keys()]) this.cancel(name);
    this.grace = null;
    this.set({
      mode: { kind: "idle" },
      expanded: false,
      paused: false,
      callAudioLost: false,
      callContact: null,
      clock: null,
      turns: [],
      assist: null,
      lastHelp: null,
      typeMenu: null,
      liveHelp: null,
      countdown: null,
      postCall: null,
    });
  }
}
