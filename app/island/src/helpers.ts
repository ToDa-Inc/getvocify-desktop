import type { Clock, Levels, Turn } from "./types.ts";

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

/** The settled words, the words still arriving (dimmed), and whether the dots show. Same rules as `TurnBubble`. */
export function turnParts(turn: Turn): { text: string; tail: string; joined: boolean; dots: boolean } {
  const words = turn.pending.split(" ").filter(Boolean).length;
  const tail = words > 2 || turn.text !== "" ? turn.pending : "";
  const joined = turn.text === "" || (tail !== "" && CLOSING_MARKS.includes(tail[0]));
  return { text: turn.text, tail, joined, dots: turn.pending !== "" };
}

export function helpText(args: {
  kind: string;
  open: boolean;
  stage: string | null;
  crmName: string | null;
  pending: number;
}): string {
  const { kind, open, stage, crmName, pending } = args;
  switch (kind) {
    case "recording":
      return open ? "Hide transcript" : "Show transcript";
    case "idle":
      return open ? "Close" : "Record a meeting";
    case "call":
      return open ? "Close" : "";
    case "postCall":
      if (stage === "writing") return "Writing the update";
      if (stage === "applying") return `Updating ${crmName ?? "the CRM"}`;
      if (open) return "Close";
      return pending === 1 ? "1 thing from your call" : pending > 1 ? `${pending} things from your call` : "";
    default:
      return "";
  }
}
