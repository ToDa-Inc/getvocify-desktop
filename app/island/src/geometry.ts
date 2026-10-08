import { briefLinesShown, type DialIslandState, type OnScreenCall } from "../../core/callIsland.ts";
import { meetingBriefLines, type IslandMeeting } from "../../core/meetingHeadsUp.ts";
import type { Geometry, Mode } from "./types.ts";

export const EAR = 82;
/** Just room for the mark, so the idle island barely widens the camera housing. */
export const IDLE_EAR = 36;
/** Room for an app icon or a small record dot, no more. */
export const CALL_EAR = 46;
export const POST_CALL_WIDTH = 420;

export const COLLAPSED_RADIUS = 12;
export const OPEN_RADIUS = 22;
export const OTHER_OPEN_RADIUS = 18;

type Kind = Mode["kind"];

const gap = (g: Geometry) => Math.max(g.notchWidth, 12);

export function earWidth(kind: Kind, open: boolean): number {
  if (open) return EAR;
  switch (kind) {
    case "idle":
      return IDLE_EAR;
    case "call":
    case "postCall":
    case "finishing":
    case "dialConfirm":
    case "dialing":
      return CALL_EAR;
    default:
      return EAR;
  }
}

export type Size = { width: number; height: number };

/** The island's shape in px. Same numbers as `IslandGeometry.size` in MeetingPill.swift. */
/** One line of the call offer's brief (11.5 px text), and the room under the lines. */
export const BRIEF_LINE = 16;
export const BRIEF_BOTTOM = 8;

/**
 * `briefLines`: the lines of the contact's recent-activity brief under the call offer (open idle island and the
 * confirm row only; 0 elsewhere).
 */
export function islandSize(g: Geometry, kind: Kind, open: boolean, postCallBody = 44, briefLines = 0): Size {
  const closed = { width: gap(g) + earWidth(kind, false) * 2, height: g.barHeight };
  const wide = (min: number) => Math.max(gap(g) + EAR * 2, min);
  const brief = briefLines > 0 ? briefLines * BRIEF_LINE + BRIEF_BOTTOM : 0;
  switch (kind) {
    case "idle":
    case "dialConfirm":
      return open ? { width: wide(380), height: g.barHeight + 56 + brief } : closed;
    case "call":
    case "stopped":
    case "finishing":
      return open ? { width: wide(380), height: g.barHeight + 56 } : closed;
    case "dialing":
      return open ? { width: wide(380), height: g.barHeight + 56 + brief } : closed;
    case "recording":
      return open ? { width: wide(460), height: Math.min(400, Math.round(g.screenHeight * 0.5)) } : closed;
    case "postCall":
      return open ? { width: wide(POST_CALL_WIDTH), height: g.barHeight + postCallBody } : closed;
    case "starting":
      return closed;
  }
}

export function cornerRadius(kind: Kind, open: boolean): number {
  if (!open) return COLLAPSED_RADIUS;
  return kind === "recording" ? OPEN_RADIUS : OTHER_OPEN_RADIUS;
}

/** The brief lines the call offer shows in this state (see `islandSize`). */
export function offerBriefLines(state: { mode: { kind: Kind }; onScreen: OnScreenCall | null; dial?: DialIslandState | null; meeting?: IslandMeeting | null }): number {
  // At rest a meeting about to start comes first (see IdleMenu).
  if (state.mode.kind === "idle" && state.meeting) return meetingBriefLines(state.meeting);
  if (state.mode.kind === "idle" || state.mode.kind === "dialConfirm") return briefLinesShown(state.onScreen);
  // Calling: the brief stays under "Calling…" (a missed call says why instead).
  if (state.mode.kind === "dialing" && state.dial && state.dial.phase !== "active" && state.dial.phase !== "ended") return state.dial.brief?.length ?? 0;
  return 0;
}
