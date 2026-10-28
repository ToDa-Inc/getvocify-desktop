import type {
  Assist, Clock, Finish, LiveContact, LiveData, LiveDecision, LiveGoal, LiveNext, LiveNow, LiveOutcome, LivePart, LivePoint, LiveProgress, LiveRecap, LiveResponder, LiveRewrite, LiveStep, LiveStepAsk, LiveView,
  BackgroundJob, MicDevice, MicView, PostCallChange, PostCallData, PostCallEmail, PostCallMeeting, PostCallType, Turn, VoiceChoice,
} from "../../island/src/types.ts";

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
      // Only a dashboard that writes typed text says so; anything else stays "edit it in Vocify".
      editable: options.length === 0 && (bool(item.editable) ?? false),
      check: bool(item.check) ?? false,
      pending: options.length > 0 && (bool(item.pending) ?? false),
      when: nonBlank(item.when),
      whenSuggested: bool(item.whenSuggested) ?? false,
      // The moment the day and hour picker starts from: only a real ISO date and time.
      dueAt: nonBlank(item.dueAt) && !Number.isNaN(Date.parse(String(item.dueAt))) ? String(item.dueAt).trim() : null,
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
    crmUrl: webUrl(raw.crmUrl),
    noAnswer: bool(raw.noAnswer) ?? false,
  };
}

/** Only a web link is ever opened from the card. */
function webUrl(raw: unknown): string | null {
  const url = nonBlank(raw);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export type LiveChannelKind = "call" | "meeting";
/** Types by channel: the recording's channel, and whether the rep may switch it (not on a Vocify call). */
export type LiveChannel = { selected: LiveChannelKind; fixed: boolean; options: { key: LiveChannelKind; label: string }[] };
export type LiveType = {
  selected: string | null;
  proposed: boolean;
  options: { key: string; label: string }[];
  channel: LiveChannel | null;
};

const CHANNEL_KINDS: readonly string[] = ["call", "meeting"];

function labelled(raw: unknown): { key: string; label: string }[] {
  return list(raw).flatMap((option) => {
    const key = str(option.key);
    const label = str(option.label);
    return key !== undefined && label !== undefined ? [{ key, label }] : [];
  });
}

/** Null unless the dashboard sent a call/meeting channel with both choices named (an older one sends none). */
export function parseLiveChannel(raw: unknown): LiveChannel | null {
  if (!isRaw(raw)) return null;
  const selected = str(raw.selected);
  const options = labelled(raw.options).filter((option): option is { key: LiveChannelKind; label: string } =>
    CHANNEL_KINDS.includes(option.key),
  );
  if (selected === undefined || !CHANNEL_KINDS.includes(selected) || options.length !== CHANNEL_KINDS.length) return null;
  return { selected: selected as LiveChannelKind, fixed: bool(raw.fixed) ?? false, options };
}

/** Null when there are no options to pick from. */
export function parseLiveType(raw: unknown): LiveType | null {
  if (!isRaw(raw)) return null;
  const options = labelled(raw.options);
  if (options.length === 0) return null;
  return { selected: str(raw.selected) ?? null, proposed: bool(raw.proposed) ?? false, options, channel: parseLiveChannel(raw.channel) };
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
  return list(overlay.turns).map((raw, index) => {
    const voice = num(raw.voice);
    const starts = Array.isArray(raw.starts) ? raw.starts.filter((s): s is number => typeof s === "number" && Number.isFinite(s)) : [];
    return {
      id: str(raw.key) ?? `row-${index}`,
      you: bool(raw.you) ?? false,
      label: str(raw.label) ?? null,
      text: str(raw.text) ?? "",
      pending: str(raw.pending) ?? "",
      // Only when the dashboard tells voices apart: a turn without them is as it always was.
      ...(voice !== undefined && Number.isInteger(voice) && voice >= 1 ? { voice } : {}),
      ...(starts.length ? { starts } : {}),
    };
  });
}

/** The voices of the other side the dashboard has heard, each with the name it shows now. */
export function parseVoices(overlay: unknown): VoiceChoice[] {
  if (!isRaw(overlay)) return [];
  return list(overlay.voices).flatMap((raw) => {
    const id = num(raw.id);
    const label = nonBlank(raw.label);
    return id !== undefined && Number.isInteger(id) && id >= 1 && label !== null ? [{ id, label }] : [];
  });
}

export function parseClock(raw: unknown): Clock | null {
  if (!isRaw(raw)) return null;
  const startedAt = num(raw.startedAt);
  if (startedAt === undefined) return null;
  return { startedAt, pausedMs: num(raw.pausedMs) ?? 0, pausedAt: num(raw.pausedAt) ?? null };
}

const FINISH_STEPS = ["stopping", "uploading", "failed", "skipped"] as const;

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


/* ---------- the live call assistant: `shell:state` liveBrain (see the shell contract, live-state-shell-contract.md) ---------- */

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const OUTCOMES: readonly LiveOutcome[] = ["open", "answered", "promised", "unanswered", "gone", "dismissed"];
const DECISIONS: readonly LiveDecision[] = ["responder", "reconducir", "aplazar", "cerrar"];

function parsePoint(raw: Raw): LivePoint | null {
  const id = nonEmpty(raw.id);
  const kind = raw.kind === "question" || raw.kind === "objection" || raw.kind === "deepen" ? raw.kind : null;
  const title = nonBlank(raw.title);
  const outcome = OUTCOMES.find((o) => o === raw.outcome);
  if (!id || !kind || !title || !outcome) return null;
  const answer = nonBlank(raw.answer);
  const fallback = nonBlank(raw.fallback);
  const source = isRaw(raw.source) ? nonBlank(raw.source.label) : null;
  return {
    id, kind, title, outcome, answer, fallback, source,
    tag: nonBlank(raw.tag),
    tagKey: nonBlank(raw.tag_key) ?? kind,
    saidAt: num(raw.said_at) ?? 0,
    decision: DECISIONS.find((d) => d === raw.decision) ?? null,
    decisionNote: nonBlank(raw.decision_note),
    gap: nonBlank(raw.gap),
    // A point whose words were not written yet is still being read; the rest is written.
    phase: answer === null && fallback === null ? "thinking" : "ready",
    repeated: bool(raw.repeated) ?? false,
    draft: false,
    turnIds: strings(raw.turn_ids),
    versions: versionsOf(raw.versions, answer ?? fallback),
  };
}

/** Every version of what to say: the first is the point's own words; a dashboard that sends none has just that one. */
function versionsOf(raw: unknown, first: string | null): string[] {
  const sent = strings(raw).map((text) => text.trim()).filter(Boolean);
  if (sent.length > 0) return sent;
  return first ? [first] : [];
}

/** What the model is writing right now, from its stream: after the open points. It has no tag yet and no kind. */
function parseDraft(raw: Raw, index: number): LivePoint {
  const say = nonBlank(raw.say);
  // What it is, as soon as it is known: the turn check's verdict or the brain's first words ("price", "question", ...).
  const tagKey = nonBlank(raw.kind) ?? "question";
  return {
    id: `draft:${index}`, kind: tagKey === "question" ? "question" : tagKey === "deepen" ? "deepen" : "objection", tag: nonBlank(raw.tag), tagKey,
    title: nonBlank(raw.title) ?? "", saidAt: Number.MAX_SAFE_INTEGER,
    decision: null, decisionNote: null, answer: say, fallback: null, gap: null, source: null,
    phase: say === null ? "thinking" : "writing", outcome: "open", repeated: false, draft: true,
    turnIds: [], versions: say ? [say] : [],
  };
}

function parseProgress(state: Raw, playbook: Raw | null): LiveProgress {
  const progress = isRaw(state.progress) ? state.progress : {};
  const doneSteps = isRaw(progress.steps) ? progress.steps : {};
  const doneData = isRaw(progress.data) ? progress.data : {};
  const heardParts = isRaw(progress.parts) ? progress.parts : {};
  const by = (item: unknown) => isRaw(item) && item.by === "rep";
  const quote = (item: unknown) => (isRaw(item) ? nonBlank(item.quote) : null);
  const named = isRaw(progress.playbook) ? progress.playbook : {};

  // Steps about how the rep talks are for coaching: never drawn live.
  const steps: LiveStep[] = list(playbook?.steps).flatMap((item) => {
    const id = nonEmpty(item.id);
    const label = nonBlank(item.label);
    if (!id || !label || item.live === false) return [];
    const done = isRaw(doneSteps[id]);
    // A step with parts: the parts the playbook lists, each heard (with the words) or not.
    const heard = isRaw(heardParts[id]) ? heardParts[id] : {};
    const parts: LivePart[] = list(item.parts).flatMap((part) => {
      const partId = nonEmpty(part.id);
      const partLabel = nonBlank(part.label);
      return partId && partLabel ? [{ id: partId, label: partLabel, done: isRaw(heard[partId]), quote: quote(heard[partId]) }] : [];
    });
    const need = num(item.need);
    return [{
      id, label, concept: nonBlank(item.concept), criterion: nonBlank(item.criterion), example: nonBlank(item.example), done, byRep: done && by(doneSteps[id]), quote: quote(doneSteps[id]),
      parts: parts.length > 0 ? parts : null, need: parts.length > 0 && need !== undefined ? Math.max(1, Math.min(parts.length, need)) : null,
    }];
  });
  const data: LiveData[] = list(playbook?.data).flatMap((item) => {
    const id = nonEmpty(item.id);
    const label = nonBlank(item.label);
    if (!id || !label) return [];
    const found = doneData[id];
    const done = isRaw(found);
    return [{
      id, label, good: nonBlank(item.good), question: nonBlank(item.question), done, byRep: done && by(found),
      value: done ? nonBlank(found.value) : null, quote: quote(found), reread: done && bool(found.reread) === true,
    }];
  });

  const missing = strings(progress.missing);
  let now: LiveNow | null = null;
  if (isRaw(progress.now)) {
    const kind = progress.now.kind === "step" || progress.now.kind === "data" || progress.now.kind === "goal" ? progress.now.kind : null;
    const id = nonEmpty(progress.now.id);
    if (kind && id) now = { kind, id, say: nonBlank(progress.now.say) };
  }
  // The producer gives the goal no wording of its own: it is drawn once it is named (reached, picked or "now"), under the
  // playbook's wording when there is one.
  const reached = isRaw(progress.goal) ? progress.goal : null;
  let goal: LiveGoal | null = null;
  if (reached || missing.includes("goal") || now?.kind === "goal") {
    goal = { label: nonBlank(playbook?.goal_label), done: reached !== null, byRep: reached !== null && by(reached), value: reached ? nonBlank(reached.value) : null, quote: reached ? nonBlank(reached.quote) : null };
  }

  return {
    playbook: { key: nonBlank(playbook?.key) ?? nonBlank(named.key), name: nonBlank(playbook?.name) ?? nonBlank(named.name) },
    hasPlaybook: bool(playbook?.has_playbook) ?? bool(progress.has_playbook) ?? false,
    steps, data, goal, missing, now,
  };
}

function parseResponder(raw: unknown): LiveResponder | null {
  if (!isRaw(raw)) return null;
  const seq = num(raw.seq);
  const status = raw.status === "reading" || raw.status === "found" || raw.status === "nothing" ? raw.status : null;
  return seq === undefined || !status ? null : { seq, status, pointId: nonEmpty(raw.point_id) };
}

function parseRecap(raw: unknown): LiveRecap | null {
  if (!isRaw(raw)) return null;
  const seq = num(raw.seq);
  const status = raw.status === "reading" || raw.status === "ready" ? raw.status : null;
  return seq === undefined || !status ? null : { seq, status, upTo: num(raw.up_to_t) ?? null, lines: strings(raw.lines), unknown: strings(raw.unknown) };
}

function parseNext(raw: unknown): LiveNext | null {
  if (!isRaw(raw)) return null;
  const kind = raw.kind === "step" || raw.kind === "data" || raw.kind === "said" ? raw.kind : null;
  const id = nonEmpty(raw.id);
  const label = nonBlank(raw.label);
  const question = nonBlank(raw.question);
  return kind && id && label && question ? { kind, id, label, question } : null;
}

function parseStepAsk(raw: unknown): LiveStepAsk | null {
  if (!isRaw(raw)) return null;
  const seq = num(raw.seq);
  const kind = raw.kind === "step" || raw.kind === "data" ? raw.kind : null;
  const id = nonEmpty(raw.id);
  const status = raw.status === "reading" || raw.status === "ready" ? raw.status : null;
  return seq === undefined || !kind || !id || !status ? null : { seq, kind, id, status, question: nonBlank(raw.question) };
}

function parseRewrite(raw: unknown): LiveRewrite | null {
  if (!isRaw(raw)) return null;
  const seq = num(raw.seq);
  const pointId = nonEmpty(raw.point_id);
  const status = raw.status === "reading" || raw.status === "ready" || raw.status === "none" ? raw.status : null;
  return seq === undefined || !pointId || !status ? null : { seq, pointId, status };
}

/** Who they are before this call; only a named contact has a brief. */
function parseLiveContact(raw: unknown): LiveContact | null {
  if (!isRaw(raw)) return null;
  const name = nonBlank(raw.name);
  if (!name) return null;
  return { name, company: nonBlank(raw.company), first: bool(raw.first) ?? false, lines: strings(raw.lines).map((line) => line.trim()).filter(Boolean) };
}

/** What the dashboard pushes under `liveBrain` (null or malformed: the island is today's). A malformed point is dropped,
 * never guessed. */
export function parseLiveBrain(raw: unknown): LiveView | null {
  if (!isRaw(raw)) return null;
  const state = isRaw(raw.state) ? raw.state : {};
  const points = list(state.points).flatMap((item) => {
    const point = parsePoint(item);
    return point ? [point] : [];
  });
  const drafts = list(raw.drafts).map(parseDraft);
  const asks = isRaw(raw.asks) ? raw.asks : {};
  return {
    on: bool(raw.on) ?? false,
    points: [...points, ...drafts],
    progress: parseProgress(state, isRaw(raw.playbook) ? raw.playbook : null),
    asks: {
      responder: parseResponder(asks.responder),
      recap: parseRecap(asks.recap),
      next: isRaw(asks.responder) ? parseNext(asks.responder.next) : null,
      step: parseStepAsk(asks.step),
      rewrite: parseRewrite(asks.rewrite),
    },
    offlineSince: num(raw.offline_since) ?? null,
    view: raw.view === "say" ? "say" : "tabs",
    contact: parseLiveContact(raw.contact),
  };
}

const JOB_STATES = ["working", "needs", "failed", "followup", "done"] as const;

/** The finished calls the dashboard is still on. Not a list at all: it does not report them (null). A malformed job is dropped. */
const micDevice = (raw: unknown): MicDevice | null => {
  if (!isRaw(raw)) return null;
  const id = nonEmpty(raw.id);
  const label = nonBlank(raw.label);
  return id && label ? { id, label } : null;
};

/** The mics the dashboard can see (`mic`): a mic without an id or a name is dropped. */
export function parseMic(raw: unknown): MicView | null {
  if (!isRaw(raw)) return null;
  return {
    devices: list(raw.devices).flatMap((d) => micDevice(d) ?? []),
    defaultLabel: nonBlank(raw.defaultLabel),
    chosen: micDevice(raw.chosen),
    inUse: nonBlank(raw.inUse),
    notice: raw.notice === true,
  };
}

export function parseBackground(raw: unknown): BackgroundJob[] | null {
  if (!Array.isArray(raw)) return null;
  const jobs: BackgroundJob[] = [];
  for (const item of list(raw)) {
    const id = nonEmpty(item.id);
    const state = JOB_STATES.find((s) => s === item.state);
    if (id && state) jobs.push({ id, name: nonBlank(item.name), state });
  }
  return jobs;
}
