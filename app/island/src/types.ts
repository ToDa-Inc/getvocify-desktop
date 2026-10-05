/** Everything the island draws. Main computes it (call logic, transcript, menus); the island only renders it. */

export type Caller = { name: string | null; icon?: string | null };

export type Mode =
  | { kind: "idle" }
  | { kind: "call"; caller: Caller }
  | { kind: "starting" }
  | { kind: "recording" }
  | { kind: "stopped"; title: string }
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

export type Clock = { startedAt: number; pausedMs: number; pausedAt: number | null };

export type Levels = { you: number; them: number; side: "you" | "them"; at: number };

export type Countdown = { total: number; remaining: number; runningSince: number | null };

export type Geometry = { notchWidth: number; barHeight: number; screenHeight: number };

export type PostCallClosed = { stage: "writing" | "ready" | "applying" | "done" | "review" | "internal"; pending: number; crmName: string | null };

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
  postCall: PostCallClosed | null;
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
  | { name: "pickCallType"; key: string | null }
  | { name: "toggleLiveHelp" }
  | { name: "pointer"; inside: boolean };

export type IslandHost = {
  onState(cb: (state: IslandState) => void): () => void;
  /** Voice levels arrive on their own channel so they never trigger a render. */
  onLevels(cb: (levels: Levels) => void): () => void;
  act(action: IslandAction): void;
};
