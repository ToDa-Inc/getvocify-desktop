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

export type OnScreenBrief = { state: "loading" } | { state: "ready"; lines: BriefLine[]; company?: CompanyBrief | null };

/** What was already said with other people at the contact's company: who and when last (from what was read), how
 * many people, and the summary's lines about it, each with who it was with. */
export type CompanyBrief = {
  name: string | null;
  latest: { type: BriefKind | null; at: string | null; who: string | null } | null;
  people: number;
  lines: BriefLine[];
};

/** What a brief line is about: the kind of the newest interaction it cites. */
export type BriefKind = "call" | "email" | "note" | "meeting" | "task" | "vocify_conversation" | "company";

/** A brief line, with the kind and date (ISO) of the newest interaction it cites; null when not given. */
export type BriefLine = { text: string; type: BriefKind | null; at: string | null; who?: string | null };

const BRIEF_KINDS = new Set<string>(["call", "email", "note", "meeting", "task", "vocify_conversation", "company"]);

/** The summary's lines the island keeps. */
const BRIEF_LINES = 3;
const COMPANY_LINES = 2;

function decodeBrief(raw: unknown): OnScreenBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.state === "loading") return { state: "loading" };
  if (r.state !== "ready") return null;
  const lines = briefLines(r.lines) ?? [];
  const company = decodeCompanyBrief(r.company);
  if (!lines.length && !company) return null;
  return company ? { state: "ready", lines, company } : { state: "ready", lines };
}

export function decodeCompanyBrief(raw: unknown): CompanyBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const latest = typeof r.latest === "object" && r.latest !== null ? (r.latest as Record<string, unknown>) : null;
  const lines = briefLines(r.lines, COMPANY_LINES) ?? [];
  if (!latest && !lines.length) return null;
  return {
    name: text(r.name),
    latest: latest ? { type: kind(latest.type), at: date(latest.at), who: text(latest.who) } : null,
    people: typeof r.people === "number" && r.people >= 0 ? Math.floor(r.people) : 0,
    lines,
  };
}

/** A dashboard before kinds and dates sent plain strings: those show as text alone. */
function briefLine(raw: unknown): BriefLine | null {
  if (typeof raw === "string") return text(raw) ? { text: text(raw)!, type: null, at: null } : null;
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lineText = text(r.text);
  if (!lineText) return null;
  const line: BriefLine = { text: lineText, type: kind(r.type), at: date(r.at) };
  return "who" in r ? { ...line, who: text(r.who) } : line;
}

function kind(value: unknown): BriefKind | null {
  return typeof value === "string" && BRIEF_KINDS.has(value) ? (value as BriefKind) : null;
}

function date(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function briefLines(raw: unknown, limit = BRIEF_LINES): BriefLine[] | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw.map(briefLine).filter((line): line is BriefLine => line !== null).slice(0, limit);
  return lines.length ? lines : null;
}

const DAY_MS = 24 * 3600 * 1000;

/** When a brief line happened, counted in the rep's calendar days ("yesterday", "3 days ago", "Aug 20"); a task's
 * date is its due date. Null when the line has no date. */
export function briefWhen(line: Pick<BriefLine, "type" | "at">, now: Date = new Date()): string | null {
  if (!line.at) return null;
  const date = new Date(line.at);
  if (Number.isNaN(date.getTime())) return null;
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(date) - midnight(now)) / DAY_MS);
  const ago = -days;
  let when: string;
  if (days === 0) when = "today";
  else if (days === -1) when = "yesterday";
  else if (days === 1) when = "tomorrow";
  else if (ago > 1 && ago < 7) when = `${ago} days ago`;
  else if (ago >= 7 && ago < 28) when = Math.floor(ago / 7) === 1 ? "1 week ago" : `${Math.floor(ago / 7)} weeks ago`;
  else if (days > 1 && days < 7) when = `in ${days} days`;
  else {
    const sameYear = date.getFullYear() === now.getFullYear();
    when = date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  return line.type === "task" ? `due ${when}` : when;
}

/** How many brief lines the offer shows (a loading brief takes one). */
export function briefLinesShown(onScreen: OnScreenCall | null | undefined): number {
  const brief = onScreen?.brief;
  if (!brief) return 0;
  if (brief.state === "loading") return 1;
  // The company part: its label and its latest row (its lines open on request).
  return brief.lines.length + (brief.company ? 2 : 0);
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
  /** What happened with the contact lately, kept for the whole call. */
  brief: BriefLine[] | null;
  /** And with other people at its company. */
  companyBrief: CompanyBrief | null;
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
    brief: briefLines(r.brief),
    companyBrief: decodeCompanyBrief(r.companyBrief),
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
