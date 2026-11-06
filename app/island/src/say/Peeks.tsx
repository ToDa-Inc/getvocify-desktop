// What was asked for, rising from the bottom over the tabs, one at a time, never over Qué decir:
// - Resumen: this call only. What you know (each with the prospect's words), what is still missing, and what happened.
// - The contact: who they are before this call.
// Pasos is a tab now (Steps.tsx); the question it asks for a step is prepared here (StepQuestion).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TypingDots } from "../TypingDots.tsx";
import { nowMs, useNow } from "../useNow.ts";
import { CloseSmall } from "../live/icons.tsx";
import { clockLabel, markKey, type Todo } from "../live/model.ts";
import { useSay } from "./context.ts";

/** A question asked for from Pasos is prepared from the call before it shows. When the dashboard has none (or no answer
 * comes in this long), a data item gets the question written from its good answer; a step gets nothing: its playbook
 * example is another prospect's sentence, not something to read out. */
const STEP_FALLBACK_MS = 4000;
const CHAR_MS = 16;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="say-panel">
      <div className="say-panel-head"><span className="live-tag" data-kind="ask">{title}</span></div>
      {children}
    </div>
  );
}

function Resumen() {
  const { live, ui, words } = useSay();
  const say = words.say;
  const recap = ui.recap;
  const known = live.progress.data.filter((d) => (markKey("data", d.id) in ui.marks ? ui.marks[markKey("data", d.id)] : d.done) && d.value);
  const unknown = recap?.state === "ready" ? recap.unknown : live.progress.data.filter((d) => !d.done).map((d) => d.label);
  const at = recap?.state === "ready" && recap.upTo !== null ? clockLabel(recap.upTo) : null;
  return (
    <Panel title={at ? say.recapTitle(at) : say.recap.label}>
      <div className="say-resumen">
        <div className="say-section">{say.known}</div>
        {known.length === 0 ? (
          <div className="dim say-line">{say.knownNone}</div>
        ) : (
          known.map((d) => (
            <div key={d.id} className="say-fact" title={d.quote ?? ""}>
              <span className="say-fact-label">{d.label}</span>
              <span className="say-fact-value">{d.value}</span>
            </div>
          ))
        )}
        {unknown.length > 0 && <div className="say-line say-missing">{say.unknown(unknown)}</div>}
        <div className="say-section">{say.happened}</div>
        {!recap || recap.state === "reading" ? (
          <div className="help-drafting"><span className="dim">{say.recapReading}</span><TypingDots /></div>
        ) : recap.lines.length === 0 ? (
          <div className="dim say-line">{say.happenedNone}</div>
        ) : (
          <ul className="live-recap">
            {recap.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function Brief() {
  const { live, words } = useSay();
  const contact = live.contact;
  if (!contact) return null;
  return (
    <Panel title={words.say.briefTitle(contact.name, contact.company)}>
      <div className="say-resumen">
        <div className="say-section">{words.say.before}</div>
        {contact.first || contact.lines.length === 0 ? (
          <div className="say-line">{words.say.firstTime}</div>
        ) : (
          contact.lines.map((line) => <div key={line} className="say-line">{line}</div>)
        )}
      </div>
    </Panel>
  );
}

/** The question for a pending item, under it: prepared from the call (about a second), then written in. */
export function StepQuestion({ todo }: { todo: Todo }) {
  const { live, ui, still } = useSay();
  const ref = useRef<HTMLDivElement>(null);
  const asked = ui.askStep!;
  const answer = live.asks.step;
  const ready = answer && answer.kind === todo.kind && answer.id === todo.id && answer.seq > asked.after && answer.status === "ready" ? answer : null;
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const now = nowMs();
  // The dashboard answered with no question of its own: the playbook's question at once. No answer at all: after a while.
  const giveUp = ready ? ready.question === null : now - asked.at > STEP_FALLBACK_MS;
  const question = ready?.question ?? (giveUp && todo.kind === "data" ? todo.ask : null);
  useEffect(() => {
    if (question && readyAt === null) setReadyAt(nowMs());
  }, [question, readyAt]);
  const since = readyAt === null ? 0 : now - readyAt;
  // Reduced motion (or a pinned clock): it just appears.
  const chars = question ? (still ? question.length : Math.floor(since / CHAR_MS)) : 0;
  useNow(50, question !== null && chars < question.length);
  useNow(250, question === null);
  // Kept in view inside the steps list only (scrolling into view would move the panels around it too).
  useEffect(() => {
    const el = ref.current;
    const list = el?.closest<HTMLElement>(".say-steps-tab");
    if (!el || !list) return;
    const below = el.offsetTop + el.offsetHeight - (list.scrollTop + list.clientHeight);
    if (below > 0) list.scrollTop += below + 2;
  }, [question !== null, chars > 0]);
  const { words } = useSay();
  if (giveUp && !question) return null;
  return (
    <div className="say-step-q" ref={ref}>
      {question === null ? (
        <span className="help-drafting"><span className="dim">{words.say.preparing}</span><TypingDots /></span>
      ) : (
        <>
          {question.slice(0, chars)}
          {chars < question.length && <span className="live-caret" />}
        </>
      )}
    </div>
  );
}

export function SayPeeks() {
  const { ui, update, words, liveHelp } = useSay();
  const peek = ui.peek;
  if (!peek || (!liveHelp && peek !== "brief")) return null;
  const body = peek === "recap" ? <Resumen /> : <Brief />;
  return (
    <div className="live-peek say-peek" key={peek} data-peek={peek}>
      <div className="live-peek-card">
        <button type="button" className="live-close live-peek-close" title={words.close} aria-label={words.close} onClick={() => update({ peek: null, askStep: null })}>
          <CloseSmall />
        </button>
        {body}
      </div>
    </div>
  );
}
