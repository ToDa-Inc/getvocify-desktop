// A meeting (with clients or internal), announced a minute before it starts (`shell:state` `meeting`,
// from the rep's calendar). A port of VocifyCore/MeetingHeadsUp.swift (same copy).

import { briefLinesOf, decodeBrief, type OnScreenBrief } from "./callIsland.ts";

export type IslandMeeting = {
  id: string;
  who: string;
  title: string | null;
  /** ms since the epoch. */
  startsAt: number;
  /** http(s) only. */
  url: string | null;
  platform: string | null;
  brief: OnScreenBrief | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function webUrl(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function decodeMeeting(raw: unknown): IslandMeeting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id);
  const who = text(r.who);
  const startsAt = typeof r.startsAt === "string" ? Date.parse(r.startsAt) : NaN;
  if (!id || !who || !Number.isFinite(startsAt)) return null;
  return { id, who, title: text(r.title), startsAt, url: webUrl(r.url), platform: text(r.platform), brief: decodeBrief(r.brief) };
}

/** How many brief lines the meeting shows (as the call offer's: same brief, same lines). */
export function meetingBriefLines(meeting: IslandMeeting | null | undefined): number {
  return briefLinesOf(meeting?.brief);
}

/** Short app names: the island is a glance, and the row must keep when and where in full. */
const APPS: Record<string, string> = { zoom: "Zoom", meet: "Meet", teams: "Teams" };

export const MeetingWording = {
  /** "in 1 min", "now", "started 3 min ago" (the island is a glance: whole minutes). */
  when(startsAt: number, now: number): string {
    const seconds = (startsAt - now) / 1000;
    if (Math.abs(seconds) < 30) return "now";
    const minutes = Math.max(Math.round(Math.abs(seconds) / 60), 1);
    return seconds > 0 ? `in ${minutes} min` : `started ${minutes} min ago`;
  },

  /** When and where ("in 1 min · Zoom"): the part of the line that must always show in full. */
  place(meeting: IslandMeeting, now: number): string {
    const app = meeting.platform ? APPS[meeting.platform] ?? null : null;
    return [MeetingWording.when(meeting.startsAt, now), app].filter((part): part is string => Boolean(part)).join(" · ");
  },

  /** Under who it is with: the meeting's title, when, and where ("Demo · in 1 min · Zoom"). */
  line(meeting: IslandMeeting, now: number): string {
    return [meeting.title, MeetingWording.when(meeting.startsAt, now), meeting.platform ? APPS[meeting.platform] ?? null : null]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  },
};
