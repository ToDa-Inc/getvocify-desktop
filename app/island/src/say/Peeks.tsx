// What was asked for, rising from the bottom over the transcript, one at a time, never over Qué decir:
// - Resumen: this call only. What you know (each with the prospect's words), what is still missing, and what happened.
// - The contact: who they are before this call.
// - Pasos: the playbook's steps in its order, each ticking itself with evidence or by the rep's tap. Hovering a pending one
//   says what it still needs (one fixed line at the foot, so nothing moves); tapping it prepares a question for it, right
//   under it, from what has been said. The list stays open.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "../icons.tsx";
import { TypingDots } from "../TypingDots.tsx";
import { nowMs, useNow } from "../useNow.ts";
import { CloseSmall, FlagIcon } from "../live/icons.tsx";
import { clockLabel, markKey, todos, type Todo } from "../live/model.ts";
import { useSay } from "./context.ts";

/** A question asked for from Pasos is prepared from the call before it shows; a dashboard that cannot prepare one (an older
 * one) gets the playbook's own question for the item after this long. */
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
function StepQuestion({ todo }: { todo: Todo }) {
  const { live, ui, still } = useSay();
  const ref = useRef<HTMLDivElement>(null);
  const asked = ui.askStep!;
  const answer = live.asks.step;
  const ready = answer && answer.kind === todo.kind && answer.id === todo.id && answer.seq > asked.after && answer.status === "ready" ? answer : null;
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const now = nowMs();
  // The dashboard answered with no question of its own: the playbook's question at once. No answer at all: after a while.
  const giveUp = ready ? ready.question === null : now - asked.at > STEP_FALLBACK_MS;
  const question = ready?.question ?? (giveUp ? todo.ask : null);
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
    const list = el?.closest<HTMLElement>(".say-steps-list");
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

function Pasos() {
  const { live, ui, update, act, words } = useSay();
  const say = words.say;
  const [hover, setHover] = useState<string | null>(null);
  const progress = live.progress;
  const all = todos(progress, ui.marks, words).filter((t) => (progress.steps.length > 0 ? t.kind !== "data" : true));
  // The playbook's order, not the brain's: this is the "guion" a team already has.
  const order = progress.steps.length > 0 ? progress.steps.map((s) => s.id) : progress.data.map((d) => d.id);
  const rows = [...all].sort((a, b) => (a.kind === "goal" ? 1 : b.kind === "goal" ? -1 : order.indexOf(a.id) - order.indexOf(b.id)));
  const total = rows.filter((r) => r.kind !== "goal").length;
  const done = rows.filter((r) => r.kind !== "goal" && r.done).length;
  // What a pending item still needs, read from the playbook (nothing is generated on hover): a step with parts, the ones
  // not heard yet and how many are enough; otherwise what it asks for.
  const missingFor = (todo: Todo): string | null => {
    if (todo.kind === "step") {
      const step = progress.steps.find((s) => s.id === todo.id);
      if (step?.parts && step.need) {
        const left = step.parts.filter((p) => !p.done);
        return left.length ? say.stillUnknown(left.map((p) => p.label.toLowerCase()), step.need, step.parts.length) : null;
      }
      return step?.concept ?? step?.criterion ?? null;
    }
    if (todo.kind === "data") return todo.hint;
    return todo.label;
  };
  const hovered = hover ? rows.find((r) => r.key === hover) ?? null : null;
  const tick = (todo: Todo) => {
    update({ marks: { ...ui.marks, [todo.key]: !todo.done } });
    act({ name: "liveTick", kind: todo.kind, id: todo.id, on: !todo.done });
  };
  const ask = (todo: Todo) => {
    if (todo.kind === "goal") return;
    if (ui.askStep && ui.askStep.kind === todo.kind && ui.askStep.id === todo.id) return update({ askStep: null });
    act({ name: "liveAskStep", kind: todo.kind, id: todo.id });
    update({ askStep: { kind: todo.kind, id: todo.id, after: live.asks.step?.seq ?? 0, at: nowMs() } });
  };
  return (
    <Panel title={say.stepsTitle(done, total)}>
      <div className="say-steps-list">
        {rows.map((todo) => {
          const asking = ui.askStep && ui.askStep.kind === todo.kind && ui.askStep.id === todo.id && !todo.done;
          return (
            <div key={todo.key} className="say-step-wrap">
              <div
                className="live-todo say-step"
                data-kind={todo.kind}
                data-done={todo.done}
                data-hover={hover === todo.key}
                onMouseEnter={() => setHover(todo.done ? null : todo.key)}
                onMouseLeave={() => setHover(null)}
              >
                <button type="button" className="live-node" data-kind={todo.kind} title={todo.done ? words.untick : words.tick} aria-label={todo.done ? words.untick : words.tick} onClick={() => tick(todo)}>
                  {todo.done ? <Check size={8} stroke={3.6} /> : todo.kind === "goal" ? <FlagIcon size={8} /> : null}
                </button>
                {!todo.done && todo.kind !== "goal" ? (
                  <button type="button" className="say-step-label say-step-ask" title={say.askThis} onClick={() => ask(todo)}>
                    <span className="say-step-text">{todo.label}</span>
                  </button>
                ) : (
                  <span className="say-step-label" title={todo.hint}><span className="say-step-text">{todo.label}</span></span>
                )}
                <span className="say-step-detail" title={todo.detail ?? ""}>{todo.byRep && todo.done ? say.markedByYou : todo.done ? todo.detail : ""}</span>
              </div>
              {asking && <StepQuestion todo={todo} />}
            </div>
          );
        })}
      </div>
      {/* One fixed line, so hovering never moves the list: what the step under the pointer still needs. */}
      {(() => {
        const hint = (hovered && missingFor(hovered)) ?? say.stepHint;
        return <div className="say-step-hint" data-on={Boolean(hovered)} title={hint}>{hint}</div>;
      })()}
    </Panel>
  );
}

export function SayPeeks() {
  const { ui, update, words, liveHelp } = useSay();
  const peek = ui.peek;
  if (!peek || (!liveHelp && peek !== "brief")) return null;
  const body = peek === "recap" ? <Resumen /> : peek === "brief" ? <Brief /> : <Pasos />;
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
