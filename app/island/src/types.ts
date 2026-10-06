/** Everything the island draws. Main computes it (call logic, transcript, menus); the island only renders it. */

export type Caller = { name: string | null; icon?: string | null };

export type Mode =
  | { kind: "idle" }
  | { kind: "call"; caller: Caller }
  | { kind: "starting" }
  | { kind: "recording" }
  | { kind: "stopped"; title: string }
  /** The recording ended: the dashboard is taking its last words and sending it, until its memo shows up as the card. */
  | { kind: "finishing" }
  | { kind: "postCall" };

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

export type TypeMenuRow = { key: string | null; label: string; checked: boolean; suggested: boolean };
export type TypeMenuView = { title: string; placeholder: boolean; sparkle: boolean; rows: TypeMenuRow[] };

/** Where the recording that just ended is, as the dashboard reports it. */
export type Finish = { step: "stopping" | "uploading" | "failed"; message: string | null };

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
  /** Scored under "needs review": shown unticked, or left to the review in Vocify. */
  check: boolean;
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
  callContact: string | null;
  clock: Clock | null;
  levels: Levels;
  turns: Turn[];
  assist: Assist | null;
  lastHelp: Assist | null;
  typeMenu: TypeMenuView | null;
  liveHelp: boolean | null;
  countdown: Countdown | null;
  geometry: Geometry;
  postCall: PostCallData | null;
  /** The recording that just ended, until its memo is being written; null when the dashboard says nothing. */
  finish: Finish | null;
  /** "vibrancy": the window blurs what is behind it (macOS). "opaque": no blur available, so the glass is denser. */
  material: "vibrancy" | "opaque";
  reduceMotion: boolean;
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
  | { name: "pickCallType"; key: string | null }
  | { name: "toggleLiveHelp" }
  | { name: "pointer"; inside: boolean }
  /** A choice in the after-call card; `type` and `details` go to the dashboard unchanged (approve, undo, review, setType, dismiss...). */
  | { name: "postCall"; type: string; details?: Record<string, unknown> };

export type IslandHost = {
  onState(cb: (state: IslandState) => void): () => void;
  /** Voice levels arrive on their own channel so they never trigger a render. */
  onLevels(cb: (levels: Levels) => void): () => void;
  act(action: IslandAction): void;
  /**
   * The after-call card is as tall as its content, which only the page can measure (fonts differ by OS).
   * The page reports the island's size in px and the window follows.
   */
  resize(size: { width: number; height: number }): void;
  /** The island never takes keyboard focus (a click must not take it from the call), except while an editable note is shown. */
  typing?(on: boolean): void;
};
