// The recording view of the live call assistant, "Qué decir" (spec 2026-10-16-live-call-assistant-design.md, revised
// 2026-10-19): the screen answers one question on its own, "what do I say now?", and everything else is there only when
// the rep asks for it. At the top, Qué decir (a list like a chat, fixed height); in the middle, the transcript; at the
// foot, Responder · Resumen · Pasos and who the call is with. What is asked for rises over the transcript, one at a time,
// and never covers Qué decir. Nothing changes view on its own.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LiveWording } from "../../../core/liveWording.ts";
import type { IslandAction, IslandState, LivePoint } from "../types.ts";
import { nowMs, useNow } from "../useNow.ts";
import { callSeconds, inWindow } from "../live/model.ts";
import { ChevronRight, ConversationIcon, RecapIcon, ShieldIcon } from "../live/icons.tsx";
import { initialSayUi, Say, useSay, type SayContext, type SayPoint, type SayUi } from "./context.ts";
import { Feed } from "./Feed.tsx";
import { SayPeeks } from "./Peeks.tsx";
import { markSeen, openIds, pickOf, setPick, unseen } from "./memory.ts";

type Act = (action: IslandAction) => void;

/** A card on screen this long after it was said counts as read: Responder then writes it again instead of pointing at it. */
const REWRITE_AFTER_S = 5;
/** With no answer from the dashboard, "Otra forma" gives up and goes back to the first version. */
const REWRITE_GIVE_UP_MS = 8000;

/** The transcript's marks: the bubbles the open cards come from, and a tap on one of theirs asks about that line. */
export type TranscriptMarks = { sources: ReadonlySet<string>; onTap: ((turnId: string) => void) | null; tapHelp: string };

export function SayBody({ state, act, transcript }: { state: IslandState; act: Act; transcript: (marks: TranscriptMarks) => ReactNode }) {
  const live = state.live!;
  const words = LiveWording.strings(state.language);
  const liveHelp = state.liveHelp !== false && live.on;
  const still = state.reduceMotion || (window as unknown as { __fixedNow?: number }).__fixedNow !== undefined;
  const [ui, setUi] = useState<SayUi>(initialSayUi);
  const update = useCallback((patch: Partial<SayUi>) => setUi((current) => ({ ...current, ...patch })), []);
  const now = useNow(250, true);

  const points: SayPoint[] = useMemo(
    () =>
      live.points
        .map((point) => {
          const outcome = ui.reopened.includes(point.id) ? "open" : ui.dismissed.includes(point.id) ? "dismissed" : point.outcome;
          return { ...point, outcome, live: outcome === "open" } as SayPoint;
        })
        .sort((a, b) => a.saidAt - b.saidAt),
    [live.points, ui.reopened, ui.dismissed],
  );

  // Everything open while the view is in front of the rep counts as seen: the closed island's marker is for what is new.
  // Opened with something new waiting: logged once, as the marker doing its job.
  useEffect(() => {
    const waiting = unseen(state, openIds(live, liveHelp));
    if (waiting) act({ name: "liveEvent", event: "marker_seen", id: waiting });
  }, []);
  useEffect(() => markSeen(state, openIds(live, liveHelp)), [state, live, liveHelp]);

  // What the rep did on their own is dropped once the dashboard's state says the same.
  useEffect(() => {
    const raw = new Map(live.points.map((p) => [p.id, p.outcome]));
    const dismissed = ui.dismissed.filter((id) => raw.get(id) === "open");
    const reopened = ui.reopened.filter((id) => raw.get(id) !== "open");
    if (dismissed.length !== ui.dismissed.length || reopened.length !== ui.reopened.length) update({ dismissed, reopened });
  }, [live.points, ui.dismissed, ui.reopened, update]);

  // The dashboard answers an ask with a newer `seq`.
  const responder = live.asks.responder;
  useEffect(() => {
    setUi((c) => {
      if (c.respond?.state !== "reading" || !responder || responder.seq <= c.respond.after || responder.status === "reading") return c;
      const found = responder.status === "found" && responder.pointId ? responder.pointId : null;
      if (!found) return { ...c, respond: { state: "nothing", at: nowMs(), from: c.respond.from } };
      const point = live.points.find((p) => p.id === found);
      const reopened = point && point.outcome !== "open" ? [...c.reopened.filter((r) => r !== found), found] : c.reopened;
      return { ...c, respond: null, reopened, flashId: found, flashAt: nowMs() };
    });
  }, [responder, live.points]);
  const recapAsk = live.asks.recap;
  useEffect(() => {
    setUi((c) => {
      if (c.recap?.state !== "reading" || !recapAsk || recapAsk.seq <= c.recap.after || recapAsk.status !== "ready") return c;
      return { ...c, recap: { state: "ready", upTo: recapAsk.upTo, lines: recapAsk.lines, unknown: recapAsk.unknown } };
    });
  }, [recapAsk]);
  // "Otra forma": the new version shows as soon as it arrives; with none (or no answer at all), back to the first.
  const rewriteAsk = live.asks.rewrite;
  useEffect(() => {
    const pending = ui.rewrite;
    if (!pending) return;
    const point = live.points.find((p) => p.id === pending.id);
    const at = nowMs();
    if (point && point.versions.length > pending.had) {
      setPick(state, pending.id, point.versions.length - 1, at);
      update({ rewrite: null });
      return;
    }
    const none = rewriteAsk && rewriteAsk.pointId === pending.id && rewriteAsk.seq > pending.after && rewriteAsk.status === "none";
    if (none || !point || at - pending.at > REWRITE_GIVE_UP_MS) {
      setPick(state, pending.id, 0, at);
      update({ rewrite: null });
    }
  }, [ui.rewrite, live.points, rewriteAsk, now, state, update]);

  const ctx: SayContext = { state, live, words, ui, update, act, points, liveHelp, still, now };
  const respond = useRespond(ctx);

  // The transcript: the bubbles the open cards come from are outlined; a tap on one of theirs asks about that line.
  const sources = useMemo(() => new Set(points.filter((p) => p.live && !p.draft).flatMap((p) => p.turnIds)), [points]);
  const onTap = useCallback(
    (turnId: string) => {
      const point = [...points].reverse().find((p) => !p.draft && p.turnIds.includes(turnId));
      const at = nowMs();
      if (point) {
        // That line already has its card: it comes into view (back, if it had closed) and pulses.
        return setUi((c) => ({ ...c, respond: null, flashId: point.id, flashAt: at, reopened: point.live ? c.reopened : [...c.reopened.filter((r) => r !== point.id), point.id] }));
      }
      act({ name: "liveRespondTurn", turnId });
      setUi((c) => ({ ...c, respond: { state: "reading", after: live.asks.responder?.seq ?? 0, from: "turn" } }));
    },
    [points, act, live.asks.responder],
  );

  return (
    <Say.Provider value={ctx}>
      <Feed />
      <div className="hairline" />
      <div className="live-views say-views">
        {transcript({ sources, onTap: liveHelp ? onTap : null, tapHelp: words.say.tapBubble })}
        <SayPeeks />
      </div>
      <SayBar onRespond={respond} />
    </Say.Provider>
  );
}

/** Responder, "what do I say now?": what they said in the last minute.
 * - A card that has only just appeared is pointed at (it may not have been read yet) and pulses.
 * - A card already on screen a while, or pointed at before: that version did not help, so it is written again in place
 *   from another angle of the same source ("otra forma"); pressed again, the next version, back to the first after the last.
 * - A card that had closed comes back (the rep wins).
 * - Nothing: the dashboard reads the minute; with nothing to answer, the next thing to find out. */
function useRespond(ctx: SayContext) {
  const { state, live, ui, update, act, points, liveHelp } = ctx;
  return () => {
    if (!liveHelp) return;
    const seconds = callSeconds(state.clock, nowMs());
    const at = nowMs();
    const inside = points.filter((p) => !p.draft && inWindow(p, seconds) && p.outcome !== "dismissed");
    const up = inside.filter((p) => p.live);
    if (up.length > 0) {
      const point = up[up.length - 1];
      const settled = point.phase === "ready" && (ui.flashId === point.id || seconds - point.saidAt > REWRITE_AFTER_S);
      if (settled && point.versions.length > 0) return rewrite(ctx, point);
      act({ name: "liveAsk", ask: "respond" });
      return update({ respond: null, flashId: point.id, flashAt: at });
    }
    act({ name: "liveAsk", ask: "respond" });
    const closed = inside.filter((p) => !p.live);
    if (closed.length > 0) {
      const id = closed[closed.length - 1].id;
      return update({ respond: null, reopened: [...ui.reopened.filter((r) => r !== id), id], flashId: id, flashAt: at });
    }
    update({ respond: { state: "reading", after: live.asks.responder?.seq ?? 0, from: "minute" } });
  };
}

/** The next version of a card: one the rep already had shows at once; past the last, the dashboard writes another. */
function rewrite(ctx: SayContext, point: LivePoint) {
  const { state, live, ui, update, act } = ctx;
  const at = nowMs();
  if (ui.rewrite) return;
  const pick = pickOf(state, point.id)?.index ?? 0;
  if (pick + 1 < point.versions.length) {
    setPick(state, point.id, pick + 1, at);
    return update({ flashId: point.id, flashAt: at });
  }
  // The brain said there is no other honest angle for this one: back to the first.
  const rewriteAsk = live.asks.rewrite;
  if (rewriteAsk && rewriteAsk.pointId === point.id && rewriteAsk.status === "none") {
    setPick(state, point.id, 0, at);
    return update({ flashId: point.id, flashAt: at });
  }
  act({ name: "liveRewrite", id: point.id, version: point.versions.length });
  update({ rewrite: { id: point.id, had: point.versions.length, after: rewriteAsk?.seq ?? 0, at }, flashId: point.id, flashAt: at });
}

/** One soft pulse when a count grows (a step done, something learned) while its list is closed. */
function useGrowPulse(count: number) {
  const last = useRef(count);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (count > last.current) setKey((k) => k + 1);
    last.current = count;
  }, [count]);
  return key;
}

const PersonIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

/** Asking, at the foot: Responder, Resumen, Pasos (no count: a live "2/6" reads as a score of the rep), and who the call
 * is with. Each opens over the transcript; a second tap closes it. */
function SayBar({ onRespond }: { onRespond: () => void }) {
  const { live, ui, update, act, words, liveHelp } = useSay();
  const progress = live.progress;
  const doneSteps = progress.steps.filter((s) => (`step:${s.id}` in ui.marks ? ui.marks[`step:${s.id}`] : s.done)).length;
  const learned = progress.data.filter((d) => d.done && d.value).length;
  const stepsPulse = useGrowPulse(doneSteps);
  const learnPulse = useGrowPulse(learned);
  const hasSteps = progress.hasPlaybook && (progress.steps.length > 0 || progress.data.length > 0);
  const toggle = (kind: "recap" | "steps" | "brief") => {
    if (ui.peek === kind) return update({ peek: null, askStep: null });
    if (kind === "recap") {
      act({ name: "liveAsk", ask: "recap" });
      return update({ peek: kind, askStep: null, recap: { state: "reading", after: live.asks.recap?.seq ?? 0 } });
    }
    act({ name: "liveEvent", event: kind === "steps" ? "open_steps" : "open_brief" });
    update({ peek: kind, askStep: null });
  };
  const say = words.say;
  return (
    <div className="live-bar-row say-bar">
      <button type="button" className="small-action live-action" data-on={ui.respond !== null} title={say.respond.help} onClick={onRespond} disabled={!liveHelp}>
        <ShieldIcon size={11} />
        <span>{say.respond.label}</span>
      </button>
      <button type="button" className="small-action live-action" data-on={ui.peek === "recap"} title={say.recap.help} onClick={() => toggle("recap")} disabled={!liveHelp}>
        {learnPulse > 0 && <span key={learnPulse} className="type-note-pulse say-pulse" aria-hidden />}
        <RecapIcon size={11} />
        <span>{say.recap.label}</span>
      </button>
      {hasSteps && (
        <button type="button" className="small-action live-action" data-on={ui.peek === "steps"} title={say.steps.help} onClick={() => toggle("steps")} disabled={!liveHelp}>
          {stepsPulse > 0 && <span key={stepsPulse} className="type-note-pulse say-pulse" aria-hidden />}
          <ConversationIcon size={11} />
          <span>{say.steps.label}</span>
        </button>
      )}
      <div className="grow" />
      {live.contact && (
        <button type="button" className="say-contact" data-on={ui.peek === "brief"} title={say.contactHelp} onClick={() => toggle("brief")}>
          <PersonIcon />
          <span>{live.contact.name}</span>
          <ChevronRight size={8} />
        </button>
      )}
    </div>
  );
}
