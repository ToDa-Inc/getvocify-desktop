// The recording view of the live call assistant, drawn inside the real island: its controls and glass stay, the body
// becomes two modes kept apart. The tabs are for looking (Transcripción, Ayuda, Conversación); the bar at the foot is for
// asking (Responder, Preguntar, Resumen), from any tab. What is asked for slides up over the open tab as a window onto the
// same thing in its own tab, never a copy, so the rep never has to leave where they are. Nothing changes tab on its own.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LiveWording } from "../../../core/liveWording.ts";
import { Check, Sparkle } from "../icons.tsx";
import { TypingDots } from "../TypingDots.tsx";
import type { IslandAction, IslandState, LivePoint, LiveTab } from "../types.ts";
import { nowMs, useNow } from "../useNow.ts";
import { NowCard, PointCard, RecapCard } from "./cards.tsx";
import { Live, initialUi, useLive, type LiveContext, type LiveUi } from "./context.ts";
import { ConversationView } from "./ConversationView.tsx";
import { HelpView } from "./HelpView.tsx";
import { ChevronRight, CloseSmall, ConversationIcon, QuestionIcon, RecapIcon, ShieldIcon, TranscriptIcon } from "./icons.tsx";
import { callSeconds, CLOSE_MS, effectiveOutcome, inWindow, nowTodo, stillMissing, tagOf, todos, waitingPoints, type PointOverlay, type ShownPoint } from "./model.ts";

type Act = (action: IslandAction) => void;

/** The points as the rep sees them. One that ends (their answer, their X, the conversation moving on) folds away into
 * Antes for a moment first, never just vanishes; one already ended when it first shows goes straight to Antes. */
function useShownPoints(points: LivePoint[], overlay: PointOverlay, reduceMotion: boolean): ShownPoint[] {
  const wasOpen = useRef(new Map<string, boolean>());
  const drafted = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const [closing, setClosing] = useState<string[]>([]);
  // Before the paint: a card that ends must not show as closed for a frame before it starts to fold.
  useLayoutEffect(() => {
    const starting: string[] = [];
    drafted.current = new Set(points.filter((p) => p.draft && p.answer).map((p) => p.answer!));
    for (const point of points) {
      seen.current.add(point.id);
      const open = effectiveOutcome(point, overlay) === "open";
      if (wasOpen.current.get(point.id) === true && !open && !reduceMotion) starting.push(point.id);
      wasOpen.current.set(point.id, open);
    }
    if (starting.length === 0) return;
    setClosing((current) => [...current, ...starting]);
    const timer = setTimeout(() => setClosing((current) => current.filter((id) => !starting.includes(id))), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [points, overlay, reduceMotion]);
  return useMemo(
    () =>
      points.map((point) => {
        const outcome = effectiveOutcome(point, overlay);
        const shown = outcome === "open" ? point.phase : closing.includes(point.id) ? ("closing" as const) : ("closed" as const);
        const landed = !point.draft && !seen.current.has(point.id) && point.answer !== null && drafted.current.has(point.answer);
        return { ...point, outcome, shown, landed };
      }),
    [points, overlay, closing],
  );
}

export function LiveBody({ state, act, transcript }: { state: IslandState; act: Act; transcript: ReactNode }) {
  const live = state.live!;
  const words = LiveWording.strings(state.language);
  const tab = state.liveTab;
  const liveHelp = state.liveHelp !== false && live.on;
  const still = state.reduceMotion || (window as unknown as { __fixedNow?: number }).__fixedNow !== undefined;
  const [ui, setUi] = useState<LiveUi>(initialUi);
  const update = useCallback((patch: Partial<LiveUi>) => setUi((current) => ({ ...current, ...patch })), []);
  const now = useNow(1000, live.offlineSince !== null);
  const overlay = useMemo(() => ({ dismissed: ui.dismissed, reopened: ui.reopened }), [ui.dismissed, ui.reopened]);
  const points = useShownPoints(live.points, overlay, state.reduceMotion);

  // What the rep did on their own is dropped once the dashboard's state says the same: from then on it is the truth.
  useEffect(() => {
    const raw = new Map(live.points.map((p) => [p.id, p.outcome]));
    const dismissed = ui.dismissed.filter((id) => raw.get(id) !== "dismissed");
    const reopened = ui.reopened.filter((id) => raw.get(id) !== "open");
    const base = todos(live.progress, {}, words);
    const marks = Object.fromEntries(Object.entries(ui.marks).filter(([key, on]) => {
      const item = base.find((todo) => todo.key === key);
      return !(item && item.done === on && (!on || item.byRep));
    }));
    const changed = dismissed.length !== ui.dismissed.length || reopened.length !== ui.reopened.length || Object.keys(marks).length !== Object.keys(ui.marks).length;
    if (changed) update({ dismissed, reopened, marks });
  }, [live, ui.dismissed, ui.reopened, ui.marks, update, words]);

  // The dashboard answers an ask with a newer `seq`: the answer is kept here, so the dashboard closing its own ask later never
  // takes it from the peek. In Ayuda a found point just pulses where it is.
  const responder = live.asks.responder;
  const recapAsk = live.asks.recap;
  useEffect(() => {
    setUi((c) => {
      if (c.respond?.state !== "reading" || !responder || responder.seq <= c.respond.after || responder.status === "reading") return c;
      const found = responder.status === "found" && responder.pointId ? responder.pointId : null;
      if (found && tab === "help" && c.peek?.kind === "respond") return { ...c, respond: { state: "found", id: found }, peek: null, flashId: found, flashAt: nowMs(), expandedId: found };
      return { ...c, respond: found ? { state: "found", id: found } : { state: "nothing" } };
    });
  }, [responder, tab]);
  useEffect(() => {
    setUi((c) => {
      if (c.recap?.state !== "reading" || !recapAsk || recapAsk.seq <= c.recap.after || recapAsk.status !== "ready") return c;
      return { ...c, recap: { state: "ready", upTo: recapAsk.upTo, lines: recapAsk.lines, unknown: recapAsk.unknown } };
    });
  }, [recapAsk]);

  const ctx: LiveContext = { state, live, words, ui, update, act, tab, points, liveHelp, still, now };
  const counts = liveHelp
    ? { help: waitingPoints(points).length, conversation: stillMissing(live.progress, ui.marks, words).slice(0, 2).length }
    : { help: 0, conversation: 0 };
  const go = (next: LiveTab) => act({ name: "liveTab", tab: next });
  const labels: { key: LiveTab; label: string; icon: ReactNode }[] = [
    { key: "transcript", label: words.tabs.transcript, icon: <TranscriptIcon /> },
    { key: "help", label: words.tabs.help, icon: <Sparkle size={10.5} /> },
    { key: "conversation", label: words.tabs.conversation, icon: <ConversationIcon /> },
  ];
  return (
    <Live.Provider value={ctx}>
      <div className="live-tabs-row">
        <div className="postcall-tabs live-tabs" role="tablist" aria-label={words.views}>
          {labels.map((v) => (
            <TabButton key={v.key} id={v.key} label={v.label} icon={v.icon} active={tab === v.key} count={v.key === "help" ? counts.help : v.key === "conversation" ? counts.conversation : 0} onPick={go} />
          ))}
        </div>
      </div>
      <div className="hairline" />
      <div className="live-views">
        <Pane active={tab === "transcript"}>{transcript}</Pane>
        <Pane active={tab === "help"}><HelpView /></Pane>
        <Pane active={tab === "conversation"}><ConversationView /></Pane>
        <Peek />
      </div>
      <ActionBar />
    </Live.Provider>
  );
}

/** Every view stays mounted: switching keeps where each one was scrolled to, and the change is a short crossfade. */
function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className="live-pane" data-active={active} aria-hidden={!active}>
      {children}
    </div>
  );
}

/** A count that grows plays one soft pulse behind its control (the type tag's pulse); a count that falls does not. */
function usePulse(count: number) {
  const last = useRef(count);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (count > last.current) setKey((k) => k + 1);
    last.current = count;
  }, [count]);
  return key;
}

function TabButton({ id, label, icon, active, count, onPick }: { id: LiveTab; label: string; icon: ReactNode; active: boolean; count: number; onPick: (tab: LiveTab) => void }) {
  const { words } = useLive();
  const pulse = usePulse(count);
  const what = id === "help" ? words.tabCount.help(count) : words.tabCount.conversation(count);
  return (
    <button type="button" role="tab" aria-selected={active} className="postcall-tab live-tab" data-active={active} title={count ? `${label} · ${what}` : label} onClick={() => onPick(id)}>
      {pulse > 0 && <span key={pulse} className="type-note-pulse live-pulse" aria-hidden />}
      <span className="live-tab-icon">{icon}</span>
      <span>{label}</span>
      {count > 0 && <span className="tab-badge">{count}</span>}
    </button>
  );
}

/* ---------- asking: one bar for every tab ---------- */

/** Responder: what they said in the last minute that needs an answer. One point per thing said: one already up is shown,
 * never written twice; a closed one the rep asks for comes back (the rep wins); the dashboard's reader reads the minute. */
function useRespond() {
  const { state, ui, update, act, points, tab, live } = useLive();
  return () => {
    act({ name: "liveAsk", ask: "respond" });
    const seconds = callSeconds(state.clock, nowMs());
    const inside = points.filter((p) => !p.draft && inWindow(p, seconds) && p.outcome !== "dismissed");
    const up = inside.filter((p) => p.shown !== "closed" && p.shown !== "closing");
    const closed = inside.filter((p) => p.shown === "closed");
    // In Ayuda the point is right there: it pulses in place instead of sliding up a second time.
    const show = (id: string) => (tab === "help" ? null : ({ kind: "point", id } as const));
    const at = nowMs();
    // A point already up is shown at once; one that had closed comes back (the rep wins). The reading goes on meanwhile.
    if (up.length > 0) {
      const id = up[up.length - 1].id;
      return update({ respond: null, flashId: id, flashAt: at, expandedId: id, peek: show(id) });
    }
    if (closed.length > 0) {
      const id = closed[closed.length - 1].id;
      return update({ respond: null, reopened: [...ui.reopened.filter((r) => r !== id), id], flashId: id, flashAt: at, expandedId: id, peek: show(id) });
    }
    update({ respond: { state: "reading", after: live.asks.responder?.seq ?? 0 }, peek: { kind: "respond" } });
  };
}

/** The three asks, and on their right the one thing waiting that is not in the open tab; a tap on it slides it up. */
function ActionBar() {
  const { live, ui, update, act, points, tab, words, liveHelp } = useLive();
  const respond = useRespond();
  const open = liveHelp ? waitingPoints(points) : [];
  const missing = liveHelp ? stillMissing(live.progress, ui.marks, words) : [];
  const kind = ui.peek?.kind ?? null;
  let chip: { lead: string; text: string; onClick: () => void } | null = null;
  if (open.length > 0 && tab !== "help") {
    const newest = open[open.length - 1];
    chip = { lead: words.waiting(open.length), text: open.map((p) => p.title.replace(/[«»]/g, "")).join(" · "), onClick: () => update({ peek: { kind: "point", id: newest.id } }) };
  } else if (missing.length > 0 && tab !== "conversation") {
    chip = { lead: words.missingLead, text: missing.map((m) => m.label).join(" · "), onClick: () => update({ peek: { kind: "now" } }) };
  }
  const toggle = (which: "now" | "recap") => {
    if (kind === which) return update({ peek: null });
    act({ name: "liveAsk", ask: which });
    update(which === "recap" ? { peek: { kind: which }, recap: { state: "reading", after: live.asks.recap?.seq ?? 0 } } : { peek: { kind: which } });
  };
  return (
    <div className="live-bar-row">
      <button type="button" className="small-action live-action" data-on={kind === "point" || kind === "respond"} title={words.respond.help} onClick={respond} disabled={!liveHelp}>
        <ShieldIcon size={11} />
        <span>{words.respond.label}</span>
      </button>
      <button type="button" className="small-action live-action" data-on={kind === "now"} title={words.ask.help} onClick={() => toggle("now")} disabled={!liveHelp || !live.progress.hasPlaybook}>
        <QuestionIcon size={11} />
        <span>{words.ask.label}</span>
      </button>
      <button type="button" className="small-action live-action" data-on={kind === "recap"} title={words.recap.help} onClick={() => toggle("recap")} disabled={!liveHelp}>
        <RecapIcon size={11} />
        <span>{words.recap.label}</span>
      </button>
      {chip && (
        <button key={chip.lead + chip.text} type="button" className="live-chip" title={chip.text} onClick={chip.onClick}>
          <span className="live-chip-dot" />
          <span className="live-chip-lead">{chip.lead}</span>
          <ChevronRight />
        </button>
      )}
    </div>
  );
}

/** What was asked for, over the open tab. Each kind is drawn by the same piece as in its own tab, from the same state:
 * a point is Ayuda's card, "Ahora" is Conversación's, and closing or ticking it here closes or ticks it there. */
function Peek() {
  const { live, ui, update, act, points, words, liveHelp } = useLive();
  const peek = ui.peek;
  if (!peek || !liveHelp) return null;
  const close = () => update({ peek: null });
  const dismiss = (id: string) => {
    update({ dismissed: [...ui.dismissed, id], reopened: ui.reopened.filter((r) => r !== id), peek: null });
    act({ name: "liveDismiss", id });
  };
  const card = (point: ShownPoint) => <PointCard point={point} flash={ui.flashId === point.id ? ui.flashAt : null} onDismiss={() => dismiss(point.id)} />;
  const reading = (
    <div className="help-drafting live-peek-empty"><span className="dim">{words.readingMinute}</span><TypingDots /></div>
  );
  const pointBody = (point: ShownPoint) =>
    point.shown === "closed" ? (
      <div className="live-peek-done"><Check size={9} stroke={3.4} /><span>{tagOf(point, words)} · {words.outcome[point.outcome]}</span></div>
    ) : card(point);
  let body: ReactNode = null;
  if (peek.kind === "point") {
    const point = points.find((p) => p.id === peek.id);
    if (!point) return null;
    body = pointBody(point);
  } else if (peek.kind === "now") {
    const now = nowTodo(live.progress, ui.marks, words);
    const tick = () => {
      if (!now) return;
      update({ marks: { ...ui.marks, [now.key]: true } });
      act({ name: "liveTick", kind: now.kind, id: now.id, on: true });
    };
    body = now ? <NowCard now={now} onTick={tick} /> : <div className="dim live-peek-empty">{words.nothingPending}</div>;
  } else if (peek.kind === "recap") {
    body = <RecapCard />;
  } else {
    // Responder: the reading, then the point the dashboard found (it may already be in Antes), else the line that says nothing.
    const answer = ui.respond;
    const found = answer?.state === "found" ? points.find((p) => p.id === answer.id) : undefined;
    body = !answer || answer.state === "reading" ? reading : found ? pointBody(found) : <div className="dim live-peek-empty">{words.nothingFound}</div>;
  }
  return (
    <div className="live-peek" key={peek.kind + ("id" in peek ? peek.id : "")}>
      <div className="live-peek-card">
        <button type="button" className="live-close live-peek-close" title={words.close} aria-label={words.close} onClick={close}>
          <CloseSmall />
        </button>
        {body}
      </div>
    </div>
  );
}
