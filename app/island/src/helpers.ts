import type { Clock, Finish, Levels, Turn } from "./types.ts";

/** "mm:ss", or "h:mm:ss" past an hour. A tick can land a hair before the whole second it stands for. */
export function formatElapsed(seconds: number): string {
  const total = Math.floor(seconds + 0.05);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Meeting seconds at `now` (ms). A paused clock stands still. */
export function elapsedSeconds(clock: Clock | null, now: number): number {
  if (!clock) return 0;
  return Math.max(0, ((clock.pausedAt ?? now) - clock.startedAt - clock.pausedMs) / 1000);
}

const FADE_SECONDS = 0.5;

/** A side that stops sending (silence) fades out on its own. */
export function fadedLevel(levels: Levels, side: "you" | "them", now: number): number {
  const value = side === "you" ? levels.you : levels.them;
  return value * Math.max(0, 1 - (now - levels.at) / 1000 / FADE_SECONDS);
}

const CLOSING_MARKS = ",.;:!?…)";

/**
 * The settled words, the words still arriving (dimmed), and whether the dots show. Same rules as `TurnBubble`.
 * Words show as soon as they arrive, even one: on a call the first thing said is "¿Hola?", and holding it back for
 * more words left a lone "•••" where the rep expected to read it.
 */
export function turnParts(turn: Turn): { text: string; tail: string; joined: boolean; dots: boolean } {
  const tail = turn.pending;
  const joined = turn.text === "" || (tail !== "" && CLOSING_MARKS.includes(tail[0]));
  return { text: turn.text, tail, joined, dots: turn.pending !== "" };
}

/** What the dashboard is doing with the recording that just ended, in words. */
export function finishLine(finish: Finish | null): string {
  switch (finish?.step) {
    case "stopping":
      return "Finishing the transcript";
    case "uploading":
      return "Sending the call to Vocify";
    case "failed":
      return finish.message ?? "Couldn't send the call";
    default:
      return "Saving the call";
  }
}

export function helpText(args: {
  kind: string;
  open: boolean;
  stage: string | null;
  crmName: string | null;
  pending: number;
  finishLine?: string;
  /** Who is being called, or why the missed call ended. */
  dialLine?: string;
}): string {
  const { kind, open, stage, crmName, pending } = args;
  switch (kind) {
    case "finishing":
      return open ? "Close" : args.finishLine ?? "Saving the call";
    case "recording":
      return open ? "Hide transcript" : "Show transcript";
    case "idle":
      return open ? "Close" : "Record a meeting";
    case "call":
      return open ? "Close" : "";
    case "dialConfirm":
      return "Close";
    case "dialing":
      return args.dialLine ?? "";
    case "postCall":
      if (stage === "writing") return "Writing the update";
      if (stage === "applying") return `Updating ${crmName ?? "the CRM"}`;
      if (open) return "Close";
      return pending === 1 ? "1 thing from your call" : pending > 1 ? `${pending} things from your call` : "";
    default:
      return "";
  }
}
