// "Qué decir" as a list, like a chat: everything the prospect said that needed an answer, in the order they said it, the
// newest at the bottom. What is still open is bright; what has been dealt with fades where it is. The list follows the
// newest unless the rep scrolled up to read something. Nothing replaces anything and nothing hides behind a counter.
//
// One fixed map, so every card reads the same way: the first line says what kind of help it is (or how it ended) and the
// prospect's words; the second is what to say.
//   Respuesta                    they asked or objected; a full card; ends "✓ Respondido"
//   No está en tu conocimiento   Vocify cannot answer it; a full card, amber; ends "✓ Apuntado para el seguimiento"
//   Puedes preguntar             an opportunity to go deeper; an outlined card, never a task; ends "✓ Preguntado"
//   Te falta saber               Responder with nothing to answer; an outlined card
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "../icons.tsx";
import { TypingDots } from "../TypingDots.tsx";
import { nowMs, useNow } from "../useNow.ts";
import { FollowScroll } from "../live/FollowScroll.tsx";
import { CloseSmall, InfoIcon, QuestionIcon } from "../live/icons.tsx";
import { nowTodo } from "../live/model.ts";
import { useSay, type SayPoint } from "./context.ts";
import { pickOf } from "./memory.ts";

/** The check shows only for a moment as acknowledgement; then the card is history like any other (no score). */
const ACK_MS = 2200;
/** How long Responder's "nothing to answer" lines stay. */
const NOTHING_MS = 4000;
const NEXT_MS = 20_000;
/** Writing speed of a new version ("otra forma"), like the brain's own stream. */
const CHAR_MS = 16;

type Kind = "answer" | "unknown" | "explore";
const kindOf = (point: SayPoint): Kind => (point.kind === "deepen" ? "explore" : point.answer === null && point.fallback !== null ? "unknown" : "answer");
const quoted = (title: string) => (/^[«"]/.test(title) ? title : `«${title}»`);

const icon = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });
const ReplyIcon = () => <svg {...icon(10)}><path d="m9 17-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>;
const KIND_ICON: Record<Kind, () => ReactNode> = { answer: ReplyIcon, unknown: () => <InfoIcon size={10} />, explore: () => <QuestionIcon size={10} /> };

type Ended = "answered" | "promised" | null;

function Card({ point, ack, flash, onDone }: { point: SayPoint; ack: boolean; flash: number | null; onDone: () => void }) {
  const { state, ui, words, still } = useSay();
  const say = words.say;
  const kind = kindOf(point);
  const KindIcon = KIND_ICON[kind];
  const ended: Ended = point.outcome === "promised" ? "promised" : point.outcome === "answered" || point.outcome === "dismissed" ? "answered" : null;
  const endedLabel = ended === "promised" ? say.ended.promised : kind === "explore" ? say.ended.asked : say.ended.answered;
  // The version the rep moved to with Responder, written in again; "Otra forma…" while the next one is being written.
  const pick = pickOf(state, point.id);
  const index = pick && pick.index < point.versions.length ? pick.index : 0;
  const text = point.versions[index] ?? point.answer ?? point.fallback ?? "";
  const rewriting = ui.rewrite?.id === point.id;
  const since = pick && index > 0 ? nowMs() - pick.at : Infinity;
  // Reduced motion (or a pinned clock): the new version just appears.
  const typing = !still && since < text.length * CHAR_MS;
  useNow(50, typing);
  const thinking = point.phase === "thinking" || rewriting;
  const writing = point.phase === "writing" || typing;
  const shown = typing ? text.slice(0, Math.max(0, Math.floor(since / CHAR_MS))) : text;
  const title = point.repeated ? `${say.repeats} · ${quoted(point.title)}` : point.title ? quoted(point.title) : "";
  const tooltip = point.answer !== null ? point.source ?? "" : [point.gap, words.sayMeanwhile].filter(Boolean).join(". ");
  return (
    <div className="say-card" data-id={point.id} data-kind={kind} data-live={point.live} data-ended={!point.live && ended && ack ? ended : "none"} title={tooltip}>
      {flash !== null && <span key={flash} className="type-note-pulse say-card-pulse" aria-hidden />}
      {/* Dealt with: a light sweeps across once and a check pops in where the kind was, then the card fades where it is. */}
      {!point.live && ended && ack && <span className="say-sweep" aria-hidden />}
      <div className="say-said">
        {!point.live && ended && ack ? (
          <span className="say-ended"><Check size={8} stroke={3.6} />{endedLabel}</span>
        ) : (
          <span className="say-kind" data-kind={kind}>
            <KindIcon />
            {say.kinds[kind]}
            {index > 0 && <span className="say-again"> · {say.again}</span>}
          </span>
        )}
        <span className="say-words">{title}</span>
        {point.live && !point.draft && !thinking && kind !== "explore" && (
          <button type="button" className="live-close say-done" title={say.done} aria-label={say.done} onClick={onDone}>
            <Check size={8} stroke={3.4} />
          </button>
        )}
      </div>
      {thinking ? (
        <div className="help-drafting"><span className="dim">{rewriting ? say.otherWay : words.reading}</span><TypingDots /></div>
      ) : (
        <div className="say-text">
          {shown}
          {writing && <span className="live-caret" />}
        </div>
      )}
    </div>
  );
}

function Offline({ since }: { since: number }) {
  const { words, now } = useSay();
  return (
    <div className="lost-line live-offline say-offline">
      <InfoIcon size={11} />
      <div>
        <div className="lost-title">{words.offlineTitle}</div>
        <div className="lost-body">{words.offlineBody(Math.max(1, Math.round((now - since) / 1000)))}</div>
      </div>
    </div>
  );
}

export function Feed() {
  const { live, ui, update, act, points, words, liveHelp, still } = useSay();
  const say = words.say;
  const ref = useRef<HTMLDivElement>(null);
  const now = nowMs();

  // Where the list looks: the newest open answer (it is needed now), else the newest open card, else the last one. A new
  // point comes into view at once; when one is dealt with, its check is seen first and the list moves a second later. A
  // card Responder brings back comes into view at once. Only these moments move it: a rep reading older ones is left alone.
  const liveIds = points.filter((p) => p.live).map((p) => p.id);
  const liveAnswer = [...points].reverse().find((p) => p.live && p.kind !== "deepen")?.id;
  const focusId = liveAnswer ?? liveIds[liveIds.length - 1] ?? points[points.length - 1]?.id;
  const seen = useRef<{ live: string[]; count: number }>({ live: [], count: 0 });
  const target = useRef<string | undefined>(undefined);
  const away = useRef(false);
  const holdUntil = useRef(0);
  const autoUntil = useRef(0);
  const [fresh, setFresh] = useState(false);
  target.current = focusId;
  const scroller = () => ref.current?.querySelector<HTMLElement>(".live-scroll") ?? null;
  const show = (id: string | undefined, smooth: boolean) => {
    const box = scroller();
    if (!box) return;
    const el = id ? ref.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
    const top = el ? el.getBoundingClientRect().bottom - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight + 2 : box.scrollHeight;
    autoUntil.current = nowMs() + 700;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth && !still ? "smooth" : "auto" });
  };
  const signature = `${liveIds.join(",")}|${points.length}`;
  // While a card is being written it grows: the list keeps it in view, unless the rep scrolled up to read.
  useEffect(() => {
    const list = ref.current?.querySelector(".say-list");
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (!away.current && nowMs() >= holdUntil.current) show(target.current, false);
    });
    observer.observe(list);
    return () => observer.disconnect();
  });
  useEffect(() => {
    const before = seen.current;
    const arrived = liveIds.some((id) => !before.live.includes(id)) || points.length > before.count;
    seen.current = { live: liveIds, count: points.length };
    if (arrived) {
      // The rep is reading something older: say there is something new, do not move the list under them.
      if (away.current) return setFresh(true);
      return show(target.current, true);
    }
    // Something was dealt with: leave its check in view a moment, then move to what is still open.
    if (away.current) return;
    holdUntil.current = nowMs() + 1100;
    const timer = setTimeout(() => show(target.current, true), 1100);
    return () => clearTimeout(timer);
  }, [signature]);
  useEffect(() => {
    if (!ui.flashId) return;
    away.current = false;
    setFresh(false);
    show(ui.flashId, true);
  }, [ui.flashId, ui.flashAt]);
  // Back at the bottom by their own scrolling: the list follows again and the notice goes. Only the rep's own wheel up
  // marks them as reading: a scroll the browser makes on its own (a card above getting shorter) must not.
  useEffect(() => {
    const box = scroller();
    if (!box) return;
    const onScroll = () => {
      if (nowMs() < autoUntil.current) return;
      if (box.scrollHeight - box.clientHeight - box.scrollTop <= 6) {
        away.current = false;
        setFresh(false);
      }
    };
    box.addEventListener("scroll", onScroll);
    return () => box.removeEventListener("scroll", onScroll);
  });
  const catchUp = () => {
    away.current = false;
    setFresh(false);
    show(target.current, true);
  };

  // When each card stopped being open: its moment of acknowledgement runs from there.
  const endedAt = useRef(new Map<string, number>());
  const wasLive = useRef(new Set<string>());
  for (const point of points) {
    if (point.live) {
      wasLive.current.add(point.id);
      endedAt.current.delete(point.id);
    } else if (wasLive.current.has(point.id) && !endedAt.current.has(point.id)) endedAt.current.set(point.id, now);
  }
  useNow(500, [...endedAt.current.values()].some((at) => now - at < ACK_MS));

  if (!liveHelp) return <div className="say-feed"><div className="say-quiet">{words.helpOff}</div></div>;

  const respond = ui.respond;
  const from = respond?.from === "turn" ? say.thatTurn : say.lastMinute;
  let tail: ReactNode = null;
  if (respond?.state === "reading") {
    tail = <div className="say-note"><span className="help-drafting"><span>{respond.from === "turn" ? say.readingTurn : say.readingMinute}</span><TypingDots /></span></div>;
  } else if (respond?.state === "nothing" && now - respond.at < NEXT_MS) {
    // Nothing to answer: the next thing to find out, the brain's pick (else the playbook's own next item and its question).
    const brain = live.asks.next;
    const fallback = brain ? null : nowTodo(live.progress, ui.marks, words);
    const next = brain ? { label: brain.label, question: brain.question } : fallback?.ask ? { label: fallback.label, question: fallback.ask } : null;
    if (next) {
      tail = (
        <div className="say-card" data-live="true" data-kind="explore" data-id="say-next">
          <div className="say-said">
            <span className="say-kind say-next" data-kind="explore"><QuestionIcon size={10} />{say.kinds.next}</span>
            <span className="say-words">{next.label}</span>
            <button type="button" className="live-close say-done" title={words.close} aria-label={words.close} onClick={() => update({ respond: null })}>
              <CloseSmall />
            </button>
          </div>
          <div className="say-text">{next.question}</div>
        </div>
      );
    } else if (now - respond.at < NOTHING_MS) {
      tail = <div className="say-note">{say.nothing(from)}</div>;
    }
  }

  return (
    <div className="say-feed" ref={ref} onWheel={(event) => { if (event.deltaY < 0) away.current = true; }}>
      {live.offlineSince !== null && <Offline since={live.offlineSince} />}
      {fresh && (
        <button type="button" className="say-fresh" onClick={catchUp} title={say.freshHelp}>{say.fresh}</button>
      )}
      {points.length === 0 && !tail ? (
        <div className="say-quiet">{say.quiet}</div>
      ) : (
        <FollowScroll follow={false} still={still}>
          <div className="say-list">
            {points.map((point) => (
              <Card
                key={point.id}
                point={point}
                ack={now - (endedAt.current.get(point.id) ?? -Infinity) < ACK_MS}
                flash={ui.flashId === point.id && ui.flashAt !== null && now - ui.flashAt < 1200 ? ui.flashAt : null}
                onDone={() => {
                  update({ dismissed: [...ui.dismissed, point.id], reopened: ui.reopened.filter((r) => r !== point.id) });
                  act({ name: "liveDismiss", id: point.id });
                }}
              />
            ))}
            {tail}
          </div>
        </FollowScroll>
      )}
    </div>
  );
}
