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
/** The call offer's recent activity until the page measures it: the hairline and "Recent activity" label, then a
 * line each (12 px text; a long one wraps and the measured height takes over). */
export const BRIEF_HEAD = 25;
export const BRIEF_LINE = 20;

/**
 * `briefLines`: the lines of the contact's recent-activity brief under the call offer (open idle island and the
 * confirm row only; 0 elsewhere).
 */
/** A meeting's heads-up is as wide as the after-call card: who, the title, when and where beside Join and Record. */
export const MEETING_WIDTH = POST_CALL_WIDTH;

export function islandSize(g: Geometry, kind: Kind, open: boolean, postCallBody = 44, briefLines = 0, meeting = false): Size {
  const closed = { width: gap(g) + earWidth(kind, false) * 2, height: g.barHeight };
  const wide = (min: number) => Math.max(gap(g) + EAR * 2, min);
  const brief = briefLines > 0 ? BRIEF_HEAD + briefLines * BRIEF_LINE : 0;
  switch (kind) {
    case "idle":
    case "dialConfirm":
      return open ? { width: wide(meeting && kind === "idle" ? MEETING_WIDTH : 380), height: g.barHeight + 56 + brief } : closed;
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

/** The open idle island shows a meeting about to start (see IdleMenu). */
export function showsMeeting(state: { mode: { kind: Kind }; meeting?: IslandMeeting | null }): boolean {
  return state.mode.kind === "idle" && Boolean(state.meeting);
}

/** The brief lines the call offer shows in this state (see `islandSize`). */
export function offerBriefLines(state: { mode: { kind: Kind }; onScreen: OnScreenCall | null; dial?: DialIslandState | null; meeting?: IslandMeeting | null }): number {
  // At rest a meeting about to start comes first (see IdleMenu).
  if (state.mode.kind === "idle" && state.meeting) return meetingBriefLines(state.meeting);
  if (state.mode.kind === "idle" || state.mode.kind === "dialConfirm") return briefLinesShown(state.onScreen);
  // Calling: the brief stays under "Calling…" (a missed call says why instead).
  if (state.mode.kind === "dialing" && state.dial && state.dial.phase !== "active" && state.dial.phase !== "ended") return (state.dial.brief?.length ?? 0) + (state.dial.companyBrief ? 2 : 0);
  return 0;
}
