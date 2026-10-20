/** Everything the island draws. Main computes it (call logic, transcript, menus); the island only renders it. */
import type { DialIslandState, OnScreenCall } from "../../core/callIsland.ts";
import type { IslandMeeting } from "../../core/meetingHeadsUp.ts";
import type { Language } from "../../core/typeProposal.ts";
import type { PillSpot } from "../../core/pill.ts";

export type { DialIslandState, OnScreenCall };

export type Caller = { name: string | null; icon?: string | null };

export type Mode =
  | { kind: "idle" }
  | { kind: "call"; caller: Caller }
  | { kind: "starting" }
  | { kind: "recording" }
  | { kind: "stopped"; title: string }
  /** The recording ended: the dashboard is taking its last words and sending it, until its memo shows up as the card. */
  | { kind: "finishing" }
  | { kind: "postCall" }
  /** The CRM contact on screen, its number and the caller ID, one click from calling. */
  | { kind: "dialConfirm" }
  /** A Vocify call is connecting or ringing, or just ended unanswered. Answered, it is `recording` with the call bar. */
  | { kind: "dialing" }
  /** A call opened on the rep's own phone (Vocify calling off), until it connects and is recorded; `failed`: it never
   * did, and the island offers to set calls from the phone up. */
  | { kind: "phoneCall"; name: string | null; failed: boolean };

export type Turn = { id: string; you: boolean; label: string | null; text: string; pending: string };

export type Assist = {
  label: string;
  isQuestion: boolean;
  /** Still being written: only the bridge line is known. */
  drafting: boolean;
  bridge: string;
  sayThis: string;
  thenAsk: string;
};

export type TypeMenuRow = { key: string; label: string; checked: boolean };
/** Types by channel: the recording's channel and the two it can be; null when it is not offered. */
export type ChannelMenuView = { title: string; rows: { key: "call" | "meeting"; label: string; checked: boolean }[] };
/** A type Vocify just set or changed, announced in the tag for a few seconds: `change` can be undone. */
export type TypeNoteView = { id: number; kind: "propose" | "change"; label: string };
/** `proposed`: the type is Vocify's, from the conversation. `note`: it was just set or changed and the tag says so. */
export type TypeMenuView = { title: string; placeholder: boolean; proposed: boolean; rows: TypeMenuRow[]; channel?: ChannelMenuView | null; note?: TypeNoteView | null };

/** Where the recording that just ended is, as the dashboard reports it. */
export type Finish = { step: "stopping" | "uploading" | "failed" | "skipped"; message: string | null };

/* ---------- the live call assistant (spec 2026-10-16-live-call-assistant-design.md) ---------- */

/** The three views of the open recording. UI state the controller keeps only because the window must be as tall. */
export type LiveTab = "transcript" | "help" | "conversation";

/** How a point ends; "open" is not ended. */
export type LiveOutcome = "open" | "answered" | "promised" | "unanswered" | "gone" | "dismissed";
export type LiveDecision = "responder" | "reconducir" | "aplazar" | "cerrar";

/** What the prospect said that needs handling, with what to say. The shell resolves it from the dashboard's LiveState. */
export type LivePoint = {
  id: string;
  /** "deepen": something important they said, with one question to go deeper (the Qué decir view only). */
  kind: "question" | "objection" | "deepen";
  /** The playbook entry's name; null: the island names the kind (`tagKey`, "Pregunta" for a question). */
  tag: string | null;
  /** "question", an objection type (price, timing...) or a playbook entry's id. */
  tagKey: string;
  /** Their words, short. */
  title: string;
  /** Seconds into the call when it was said. */
  saidAt: number;
  decision: LiveDecision | null;
  /** The decision line above what to say; shown only when the decision is not a plain answer. */
  decisionNote: string | null;
  /** What to say; null when the knowledge has nothing (then `fallback`). */
  answer: string | null;
  /** The honest line to say meanwhile when the fact is not in the knowledge. */
  fallback: string | null;
  /** What is not written (the tooltip of a card with no answer). */
  gap: string | null;
  /** Where the answer comes from (the tooltip of a card). */
  source: string | null;
  /** thinking: nothing written yet; writing: the text is still arriving; ready. */
  phase: "thinking" | "writing" | "ready";
  outcome: LiveOutcome;
  /** They came back to it ("Lo repite"). */
  repeated: boolean;
  /** Being written from the model's stream: no tag yet, the point lands later with its final words. */
  draft: boolean;
  /** The transcript turns it comes from (the bubbles it outlines). */
  turnIds: string[];
  /** What to say, every version so far: the first answer (or honest line), then each "otra forma" the rep asked for. */
  versions: string[];
};

/** A part of a step whose criterion lists several things to find out ("al menos tres de estos datos"). */
export type LivePart = { id: string; label: string; done: boolean; quote: string | null };
export type LiveStep = {
  id: string; label: string; concept: string | null; criterion: string | null; example: string | null; done: boolean; byRep: boolean; quote: string | null;
  /** Only for a step with parts: the parts, and how many are enough. */
  parts: LivePart[] | null;
  need: number | null;
};
export type LiveData = { id: string; label: string; good: string | null; question: string | null; done: boolean; byRep: boolean; value: string | null; quote: string | null; reread: boolean };
/** `label` null: the playbook has no wording for the goal ("The call's goal"). */
export type LiveGoal = { label: string | null; done: boolean; byRep: boolean; value: string | null; quote: string | null };
export type LiveNow = { kind: "step" | "data" | "goal"; id: string; say: string | null };

/** Where the call is against the playbook: the playbook's own steps and data, resolved with the call's progress. */
export type LiveProgress = {
  playbook: { key: string | null; name: string | null };
  hasPlaybook: boolean;
  steps: LiveStep[];
  data: LiveData[];
  goal: LiveGoal | null;
  /** The brain's picks, most important first (ids of steps, data or "goal"). */
  missing: string[];
  now: LiveNow | null;
};

/** The answers to the rep's asks. `seq` grows by one per tap, so a new ask is told from an old answer. */
export type LiveResponder = { seq: number; status: "reading" | "found" | "nothing"; pointId: string | null };
export type LiveRecap = { seq: number; status: "reading" | "ready"; upTo: number | null; lines: string[]; unknown: string[] };
/** Responder with nothing to answer: the missing item that matters most, with its question. */
/** Responder with nothing to answer: a missing playbook item and its question, or ("said") a question on the last thing they said. */
export type LiveNext = { kind: "step" | "data" | "said"; id: string; label: string; question: string };
/** A question for one pending step or data item, asked for from Pasos. */
export type LiveStepAsk = { seq: number; kind: "step" | "data"; id: string; status: "reading" | "ready"; question: string | null };
/** "Otra forma" for one point: being written, written (a new version), or none (no other honest angle). */
export type LiveRewrite = { seq: number; pointId: string; status: "reading" | "ready" | "none" };
/** Who they are before this call: `first` when there was no earlier interaction. */
export type LiveContact = { name: string; company: string | null; first: boolean; lines: string[] };

/** What the dashboard pushes under `liveBrain` while the live-brain flag is on; null, and the island is today's. */
export type LiveView = {
  /** The brain is reading for this call (flag on and live help on). */
  on: boolean;
  /** Open and ended points, oldest first, then the drafts being written. */
  points: LivePoint[];
  progress: LiveProgress;
  asks: { responder: LiveResponder | null; recap: LiveRecap | null; next: LiveNext | null; step: LiveStepAsk | null; rewrite: LiveRewrite | null };
  /** ms since the epoch of the last good reading, once the brain stopped answering; null when it answers. */
  offlineSince: number | null;
  /** "say": the Qué decir view (spec revised 2026-10-19); "tabs": the tabs view of 2026-10-16. */
  view: "say" | "tabs";
  contact: LiveContact | null;
};

/** A rep's ask or action in the live assistant, forwarded to the dashboard (`shell.onLiveAction`). */
export type LiveAction =
  | { name: "liveAsk"; ask: "respond" | "now" | "recap" }
  | { name: "liveTick"; kind: "step" | "data" | "goal"; id: string; on: boolean }
  | { name: "liveDismiss"; id: string }
  | { name: "liveTab"; tab: LiveTab }
  /** Qué decir: another version of a point's answer (`version`: how many the island already has). */
  | { name: "liveRewrite"; id: string; version: number }
  /** Pasos: a question for one pending item. */
  | { name: "liveAskStep"; kind: "step" | "data"; id: string }
  /** Responder about one tapped bubble of theirs. */
  | { name: "liveRespondTurn"; turnId: string }
  /** What the rep did, for the events log (never changes anything). */
  | { name: "liveEvent"; event: LiveEventKind; id?: string };

export type LiveEventKind = "open_recap" | "open_steps" | "open_brief" | "marker_shown" | "marker_seen" | "shown";

export type Clock = { startedAt: number; pausedMs: number; pausedAt: number | null };

export type Levels = { you: number; them: number; side: "you" | "them"; at: number };

export type Countdown = { total: number; remaining: number; runningSince: number | null };

export type Geometry = { notchWidth: number; barHeight: number; screenHeight: number };

export type PostCallStage = "writing" | "ready" | "applying" | "done" | "review" | "internal";

export type PostCallOption = { value: string; label: string };

export type PostCallChange = {
  /** `object_type:field_name`, the key Vocify's review omits fields by. */
  key: string;
  label: string;
  /** The record it lands on: contact, company, deal or other. */
  object: string;
  /** As the rep reads it; null when the CRM has nothing. */
  from: string | null;
  to: string;
  /** What gets written: the option value(s), ";"-joined for a checkbox list. */
  value: string;
  /** Picked from in place; empty for free text, which is edited in Vocify. */
  options: PostCallOption[];
  multiple: boolean;
  /** Free text the dashboard will write as typed: the card lets the rep type over it. False everywhere else. */
  editable: boolean;
  /** Scored under "needs review": ticked like the rest, with a mark saying Vocify was less sure. */
  check: boolean;
  /** Nothing was proposed (the lead status): ticked and written only once the rep picks a value. */
  pending: boolean;
  /** A task's day and hour as the rep reads them ("Tue 20 Oct, 09:00"); null for anything that is not a task. */
  when: string | null;
  /** The call gave the task no day: `when` is only the default it will be written with. */
  whenSuggested: boolean;
  /** A task's due moment (ISO, with offset), which the day and hour picker starts from; null for anything else. */
  dueAt: string | null;
};

export type PostCallEmail = { state: "writing" | "ready" | "skipped" | "sent"; to: string | null; subject: string | null; preview: string | null };
export type PostCallMeeting = { state: "pending" | "check" | "added"; when: string | null };
export type PostCallType = { key: string; label: string; options: { key: string; label: string }[] };

/** What the dashboard says about the call that just ended (the Swift `PostCall`). A part that doesn't apply is null. */
export type PostCallData = {
  stage: PostCallStage;
  memoId: string;
  contactName: string | null;
  changes: PostCallChange[];
  canApprove: boolean;
  applied: number | null;
  /** ms since the epoch: the write is held until then so it can be undone. */
  undoUntil: number | null;
  note: string | null;
  email: PostCallEmail | null;
  meeting: PostCallMeeting | null;
  notes: boolean;
  /** The note's first lines, plain text. */
  summary: string | null;
  /** The connected CRM's name; the card says "the CRM" when it isn't known. */
  crm: string | null;
  offerStopEmails: boolean;
  type: PostCallType | null;
  /** The updated record in the CRM, once written; null when it has no link. */
  crmUrl: string | null;
  /** Nobody answered (a voicemail): the card offers only the lead status and tasks, and no note. */
  noAnswer: boolean;
};

/** What still needs the rep; the count on the closed island. */
export function postCallPending(data: PostCallData): number {
  return (
    (data.stage === "ready" || data.stage === "review" ? 1 : 0) +
    (data.email?.state === "ready" ? 1 : 0) +
    (data.meeting && data.meeting.state !== "added" ? 1 : 0)
  );
}

export function postCallCrmName(data: PostCallData): string {
  return data.crm ?? "the CRM";
}

export type IslandState = {
  mode: Mode;
  expanded: boolean;
  paused: boolean;
  recorderReady: boolean;
  callAudioLost: boolean;
  /** The mic has sent only silence for a while (muted, or the wrong input): the dashboard watches it. */
  micSilent: boolean;
  callContact: string | null;
  clock: Clock | null;
  levels: Levels;
  turns: Turn[];
  assist: Assist | null;
  lastHelp: Assist | null;
  typeMenu: TypeMenuView | null;
  liveHelp: boolean | null;
  /** The live call assistant (tabs, bar, peek); null: the flag is off and the island is today's. */
  live: LiveView | null;
  liveTab: LiveTab;
  /** Where the island sits (the rep's setting): under the notch, or "side": a pill on any edge of any screen. */
  placement: "notch" | "side";
  /** The pill's edge and place along it (placement "side"), as the rep left it. */
  pill: PillSpot;
  countdown: Countdown | null;
  geometry: Geometry;
  postCall: PostCallData | null;
  /** The recording that just ended, until its memo is being written; null when the dashboard says nothing. */
  finish: Finish | null;
  /** The CRM contact in the frontmost browser the island can offer to call (`shell:state` onScreen). */
  onScreen: OnScreenCall | null;
  /** The Vocify call in progress, if any (`shell:state` dial). */
  dial: DialIslandState | null;
  /** A meeting (with clients or internal) about to start (`shell:state` meeting, from the calendar). */
  meeting: IslandMeeting | null;
  /** The browser in front that macOS won't let Vocify read (so no call offer): the island says so, with Fix. */
  crmBlocked: { browser: string } | null;
  keypadOpen: boolean;
  /** "vibrancy": the window blurs what is behind it (macOS). "opaque": no blur available, so the glass is denser. */
  material: "vibrancy" | "opaque";
  reduceMotion: boolean;
  /** The rep's language, for the words the island writes itself (the rest comes from the dashboard). */
  language: Language;
};

export type IslandAction =
  | { name: "toggle" }
  | { name: "record" }
  | { name: "dismissCall" }
  | { name: "openApp" }
  | { name: "togglePause" }
  | { name: "stop" }
  | { name: "resume" }
  /** End the stopped recording now, without waiting for its line to run out. */
  | { name: "finish" }
  /** Throw the stopped recording away: nothing is sent, kept or written. */
  | { name: "discard" }
  /** Close the card that says the ended recording failed. */
  | { name: "dismissFinish" }
  | { name: "pickCallType"; key: string | null }
  /** Undo on "Cambia a ...": back to the type before, now the rep's. */
  | { name: "undoCallType" }
  | { name: "pickChannel"; kind: "call" | "meeting" }
  | { name: "toggleLiveHelp" }
  | LiveAction
  | { name: "pointer"; inside: boolean }
  /** Calling the contact on screen (sent to the dashboard as the bridge contract's commands). */
  | { name: "openDialConfirm" }
  | { name: "dial" }
  | { name: "hangup" }
  | { name: "toggleMute" }
  | { name: "keypad"; open: boolean }
  | { name: "digit"; digit: string }
  | { name: "openCalling" }
  /** A call opened on the rep's phone: stop waiting for it, or set calls from the phone up (it never connected). */
  | { name: "cancelPhoneCall" }
  | { name: "setUpPhone" }
  | { name: "joinMeeting" }
  | { name: "dismissMeeting" }
  | { name: "fixCrmAccess" }
  /** A choice in the after-call card; `type` and `details` go to the dashboard unchanged (approve, undo, review, setType, dismiss...). */
  | { name: "postCall"; type: string; details?: Record<string, unknown> };

export type IslandHost = {
  /** The system the island runs on: typing is handed over differently on Windows (see `keyboard`). */
  platform?: string;
  onState(cb: (state: IslandState) => void): () => void;
  /** Voice levels arrive on their own channel so they never trigger a render. */
  onLevels(cb: (levels: Levels) => void): () => void;
  act(action: IslandAction): void;
  /**
   * The after-call card is as tall as its content, which only the page can measure (fonts differ by OS).
   * The page reports the island's size in px and the window follows.
   */
  resize(size: { width: number; height: number }): void;
  /** As a pill, the window lets clicks through except over the pill and its open panel: the page says which. */
  interactive?(on: boolean): void;
  /** The pill is being dragged: where the pointer is on the whole desktop (the window follows it onto another screen). */
  pillDrag?(screenX: number, screenY: number): void;
  /** The pill was let go: its edge and place, remembered with the screen it is on. */
  pillDrop?(spot: PillSpot): void;
  /**
   * The island never takes the keyboard (a click must not take it from the call) unless the rep types in it:
   * "available" while a card with fields is shown, "over" while the pointer is over a field (so the click in it focuses
   * the window), "release" when the typing is done or the pointer leaves (the keyboard goes back), "off" when the card is gone.
   */
  /** Puts text on the clipboard: the island never takes the keyboard, so its text cannot be copied with the shortcut. */
  copy?(text: string): Promise<boolean>;
  keyboard?(mode: "available" | "over" | "now" | "release" | "off"): Promise<unknown>;
};
