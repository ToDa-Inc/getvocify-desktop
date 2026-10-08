// A meeting (with clients or internal), announced a minute before it starts (`shell:state` `meeting`,
// from the rep's calendar). A port of VocifyCore/MeetingHeadsUp.swift (same copy).

import type { OnScreenBrief } from "./callIsland.ts";

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

/** The brief's lines the island keeps (as for the call offer). */
const BRIEF_LINES = 3;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeBrief(raw: unknown): OnScreenBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.state === "loading") return { state: "loading" };
  if (r.state !== "ready" || !Array.isArray(r.lines)) return null;
  const lines = r.lines.map(text).filter((line): line is string => line !== null).slice(0, BRIEF_LINES);
  return lines.length ? { state: "ready", lines } : null;
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

/** How many brief lines the meeting shows (a loading brief takes one). */
export function meetingBriefLines(meeting: IslandMeeting | null | undefined): number {
  const brief = meeting?.brief;
  if (!brief) return 0;
  return brief.state === "loading" ? 1 : brief.lines.length;
}

const APPS: Record<string, string> = { zoom: "Zoom", meet: "Google Meet", teams: "Teams" };

export const MeetingWording = {
  /** "in 1 min", "now", "started 3 min ago" (the island is a glance: whole minutes). */
  when(startsAt: number, now: number): string {
    const seconds = (startsAt - now) / 1000;
    if (Math.abs(seconds) < 30) return "now";
    const minutes = Math.max(Math.round(Math.abs(seconds) / 60), 1);
    return seconds > 0 ? `in ${minutes} min` : `started ${minutes} min ago`;
  },

  /** Under who it is with: the meeting's title, when, and where ("Demo · in 1 min · Zoom"). */
  line(meeting: IslandMeeting, now: number): string {
    return [meeting.title, MeetingWording.when(meeting.startsAt, now), meeting.platform ? APPS[meeting.platform] ?? null : null]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  },
};
