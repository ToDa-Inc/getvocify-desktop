// Calling the CRM contact on screen: the `onScreen` and `dial` shell state, their wording, and the
// CRM pages sent to the dashboard. A port of VocifyCore/CallIsland.swift + CrmScreen.swift (same copy).
// Contract: getvocify docs/superpowers/specs/2026-10-06-desktop-calling-design.md.

export type OnScreenState = "callable" | "no_phone" | "needs_contact" | "no_caller_id";

/** The CRM contact in the frontmost browser the island can offer to call. */
export type OnScreenCall = {
  provider: string;
  crmLabel: string;
  name: string | null;
  /** E.164. */
  phone: string | null;
  /** The verified number the call goes out from. */
  callerId: string | null;
  state: OnScreenState;
  /** What happened with the contact lately (the dashboard's recent-activity summary): loading, or its lines. */
  brief?: OnScreenBrief | null;
};

export type OnScreenBrief = { state: "loading" } | { state: "ready"; lines: string[] };

/** The island is a glance: two lines at most. */
const BRIEF_LINES = 2;

function decodeBrief(raw: unknown): OnScreenBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.state === "loading") return { state: "loading" };
  if (r.state !== "ready" || !Array.isArray(r.lines)) return null;
  const lines = r.lines.map(text).filter((line): line is string => line !== null).slice(0, BRIEF_LINES);
  return lines.length ? { state: "ready", lines } : null;
}

/** How many brief lines the offer shows (a loading brief takes one). */
export function briefLinesShown(onScreen: OnScreenCall | null | undefined): number {
  const brief = onScreen?.brief;
  if (!brief) return 0;
  return brief.state === "loading" ? 1 : brief.lines.length;
}

/** A Vocify call in progress, or one that ended unanswered. */
export type DialIslandState = {
  phase: "connecting" | "ringing" | "active" | "ended";
  name: string | null;
  phone: string;
  /** ms since the epoch. */
  answeredAt: number | null;
  muted: boolean;
  /** Why an unanswered call ended, in the rep's language. */
  message: string | null;
};

const STATES = new Set<OnScreenState>(["callable", "no_phone", "needs_contact", "no_caller_id"]);
const PHASES = new Set<DialIslandState["phase"]>(["connecting", "ringing", "active", "ended"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function decodeOnScreen(raw: unknown): OnScreenCall | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const state = r.state as OnScreenState;
  const provider = text(r.provider);
  const crmLabel = text(r.crmLabel);
  if (!STATES.has(state) || !provider || !crmLabel) return null;
  return { provider, crmLabel, name: text(r.name), phone: text(r.phone), callerId: text(r.callerId), state, brief: decodeBrief(r.brief) };
}

export function decodeDial(raw: unknown): DialIslandState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const phase = r.phase as DialIslandState["phase"];
  const phone = text(r.phone);
  if (!PHASES.has(phase) || !phone) return null;
  return {
    phase,
    name: text(r.name),
    phone,
    answeredAt: typeof r.answeredAt === "number" ? r.answeredAt : null,
    muted: r.muted === true,
    message: text(r.message),
  };
}

/** While a Vocify call is up the island must not offer or start any other recording. */
export function isVocifyCallUp(dial: DialIslandState | null): boolean {
  return dial !== null && dial.phase !== "ended";
}

/** The dashboard's phone display (`formatCallerIdDisplay`): Spanish numbers grouped, others as stored. */
export const PhoneFormat = {
  grouped(e164: string): string {
    const digits = e164.replace(/\D/g, "");
    if (!e164.startsWith("+34") || digits.length !== 11) return e164;
    const n = digits.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  },
};

export const CallWording = {
  glyphHelp(s: OnScreenCall): string {
    switch (s.state) {
      case "callable":
        return `Call ${s.name ?? PhoneFormat.grouped(s.phone ?? "")}`;
      case "no_phone":
        return `No phone in ${s.crmLabel}`;
      case "no_caller_id":
        return "Add a caller ID to call";
      case "needs_contact":
        return "Open the contact to call";
    }
  },

  confirm(s: OnScreenCall): { title: string; line: string; button: string | null } {
    const title = s.name ?? (s.phone ? PhoneFormat.grouped(s.phone) : s.crmLabel);
    switch (s.state) {
      case "callable":
        return { title, line: PhoneFormat.grouped(s.phone ?? ""), button: "Call" };
      case "no_phone":
        return { title, line: `No phone in ${s.crmLabel}`, button: null };
      case "no_caller_id":
        return { title, line: "Add a caller ID to call", button: "Add caller ID" };
      case "needs_contact":
        return { title: `${s.crmLabel} record with several contacts`, line: "Open the contact to call", button: null };
    }
  },

  dialing(d: DialIslandState): string {
    return `Calling ${d.name ?? PhoneFormat.grouped(d.phone)}…`;
  },

  ended(d: DialIslandState): string {
    return d.message ?? "Call ended";
  },
};

/** The CRM pages in the frontmost browser, sent to the dashboard (`crm:screen`) only when they change. */
export class CrmScreenChange {
  private last: string[] | null = null;

  next(urls: string[]): string[] | null {
    if (this.last && this.last.length === urls.length && this.last.every((url, i) => url === urls[i])) return null;
    this.last = [...urls];
    return urls;
  }
}

/** One answer for "may Vocify read the CRM tab", from each running browser's Automation consent. */
export const CrmTabsAccess = {
  aggregate(perBrowser: string[]): "authorized" | "denied" | "never_requested" | "unavailable" {
    if (perBrowser.includes("granted") || perBrowser.includes("authorized")) return "authorized";
    if (perBrowser.includes("denied")) return "denied";
    if (perBrowser.includes("not_asked")) return "never_requested";
    return "unavailable";
  },
};
