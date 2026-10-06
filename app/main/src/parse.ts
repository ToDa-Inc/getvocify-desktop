import type { Assist, Clock, Finish, PostCallChange, PostCallData, PostCallEmail, PostCallMeeting, PostCallType, Turn } from "../../island/src/types.ts";

/**
 * Turns what the dashboard pushes through `shell:state` into the island's types. The rules are the Swift
 * initialisers in MeetingPill.swift (`PostCall.init`, `LiveType.init`, the `assist`, `overlay`, `clock` and
 * `callContact` branches of `MeetingPillState.apply`): a malformed part is dropped, never guessed.
 */

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const nonEmpty = (value: unknown): string | null => {
  const text = str(value);
  return text !== undefined && text.length > 0 ? text : null;
};
const nonBlank = (value: unknown): string | null => {
  const text = str(value);
  return text !== undefined && text.trim().length > 0 ? text : null;
};
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRaw) : []);

const STAGES = ["writing", "ready", "applying", "done", "review", "internal"] as const;
const EMAIL_STATES = ["writing", "ready", "skipped", "sent"] as const;
const MEETING_STATES = ["pending", "check", "added"] as const;

export function parsePostCall(raw: unknown): PostCallData | null {
  if (!isRaw(raw)) return null;
  const stage = STAGES.find((s) => s === raw.stage);
  const memoId = str(raw.memoId);
  if (!stage || memoId === undefined) return null;

  const changes: PostCallChange[] = [];
  for (const item of list(raw.changes)) {
    const key = str(item.key);
    const to = str(item.to);
    if (key === undefined || to === undefined) continue;
    const options = list(item.options).flatMap((option) => {
      const value = str(option.value);
      return value ? [{ value, label: str(option.label) ?? value }] : [];
    });
    changes.push({
      key,
      label: str(item.label) ?? key,
      object: str(item.object) ?? "other",
      from: nonEmpty(item.from),
      to,
      value: str(item.value) ?? to,
      options,
      multiple: options.length > 0 && (bool(item.multiple) ?? false),
      check: bool(item.check) ?? false,
    });
  }

  let email: PostCallEmail | null = null;
  const emailRaw = raw.email;
  if (isRaw(emailRaw)) {
    const state = EMAIL_STATES.find((s) => s === emailRaw.state);
    if (state) email = { state, to: nonBlank(emailRaw.to), subject: nonBlank(emailRaw.subject), preview: nonBlank(emailRaw.preview) };
  }

  let meeting: PostCallMeeting | null = null;
  const meetingRaw = raw.meeting;
  if (isRaw(meetingRaw)) {
    const state = MEETING_STATES.find((s) => s === meetingRaw.state);
    if (state) meeting = { state, when: str(meetingRaw.when) ?? null };
  }

  let type: PostCallType | null = null;
  const typeRaw = raw.type;
  if (isRaw(typeRaw)) {
    const key = str(typeRaw.key);
    const label = str(typeRaw.label);
    if (key !== undefined && label !== undefined) {
      type = { key, label, options: list(typeRaw.options).flatMap((o) => (str(o.key) !== undefined && str(o.label) !== undefined ? [{ key: str(o.key)!, label: str(o.label)! }] : [])) };
    }
  }

  return {
    stage,
    memoId,
    contactName: nonEmpty(raw.contactName),
    changes,
    canApprove: bool(raw.canApprove) ?? false,
    applied: num(raw.applied) ?? null,
    undoUntil: num(raw.undoUntil) ?? null,
    note: nonEmpty(raw.note),
    email,
    meeting,
    notes: bool(raw.notes) ?? false,
    summary: nonBlank(raw.summary),
    crm: nonBlank(raw.crm),
    offerStopEmails: bool(raw.offerStopEmails) ?? false,
    type,
  };
}

export type LiveType = { selected: string | null; proposed: boolean; options: { key: string; label: string }[] };

/** Null when there are no options to pick from. */
export function parseLiveType(raw: unknown): LiveType | null {
  if (!isRaw(raw)) return null;
  const options = list(raw.options).flatMap((option) => {
    const key = str(option.key);
    const label = str(option.label);
    return key !== undefined && label !== undefined ? [{ key, label }] : [];
  });
  if (options.length === 0) return null;
  return { selected: str(raw.selected) ?? null, proposed: bool(raw.proposed) ?? false, options };
}

/** A draft is the loading state; a card with no answer keeps its filler line; nothing at all is no card. */
export function parseAssist(raw: unknown): Assist | null {
  if (!isRaw(raw)) return null;
  const drafting = raw.stage === "draft";
  const sayThis = str(raw.sayThis) ?? "";
  const bridge = str(raw.bridge) ?? "";
  if (!(drafting || sayThis !== "" || bridge !== "")) return null;
  return {
    label: str(raw.label) ?? "",
    isQuestion: raw.kind === "question",
    drafting,
    bridge,
    sayThis,
    thenAsk: str(raw.thenAsk) ?? "",
  };
}

export function parseTurns(overlay: unknown): Turn[] | null {
  if (!isRaw(overlay)) return null;
  return list(overlay.turns).map((raw, index) => ({
    id: str(raw.key) ?? `row-${index}`,
    you: bool(raw.you) ?? false,
    label: str(raw.label) ?? null,
    text: str(raw.text) ?? "",
    pending: str(raw.pending) ?? "",
  }));
}

export function parseClock(raw: unknown): Clock | null {
  if (!isRaw(raw)) return null;
  const startedAt = num(raw.startedAt);
  if (startedAt === undefined) return null;
  return { startedAt, pausedMs: num(raw.pausedMs) ?? 0, pausedAt: num(raw.pausedAt) ?? null };
}

const FINISH_STEPS = ["stopping", "uploading", "failed"] as const;

/** `{ step, message? }`: where the recording that just ended is. An unknown step is dropped. */
export function parseFinish(raw: unknown): Finish | null {
  if (!isRaw(raw)) return null;
  const step = FINISH_STEPS.find((s) => s === raw.step);
  return step ? { step, message: str(raw.message) ?? null } : null;
}

/** `{ name }` from the dashboard; blank is no contact. */
export function parseContact(raw: unknown): string | null {
  if (!isRaw(raw)) return null;
  const name = str(raw.name)?.trim();
  return name ? name : null;
}
