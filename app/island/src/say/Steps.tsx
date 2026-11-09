// The playbook's steps while the transcript is the main view (2026-11-09, Dani: "transcript as main, steps on demand").
// - StepsLine: one line over the transcript, always there. A dot per step (filled when covered), the step the call is on
//   and what is still left; amber when the call went past a step without covering it. A tap opens the sheet.
// - StepsSheet: over the transcript. What is still to cover first, in any order (nothing waits on a tick), the step the
//   call is on open with what it asks and the brain's question from this call; then what is covered, folded, each with
//   the prospect's words that covered it. A tap on the circle is only a correction.
// Never the playbook's example sentence: that is another prospect's words, and read out word for word it is a script.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "../icons.tsx";
import { nowMs } from "../useNow.ts";
import { ChevronRight, CloseSmall, FlagIcon } from "../live/icons.tsx";
import { todos, type Todo } from "../live/model.ts";
import { useSay } from "./context.ts";
import { StepQuestion } from "./Peeks.tsx";

/** The steps as the rep sees them: covered or not (the rep's ticks win), the one the call is on, the ones it went past. */
export function useStepRows() {
  const { live, ui, words } = useSay();
  const progress = live.progress;
  const all = todos(progress, ui.marks, words);
  const byId = (kind: Todo["kind"], id: string) => all.find((t) => t.kind === kind && t.id === id) ?? null;
  // The playbook's order, not the brain's: this is the "guion" a team already has. The goal comes last.
  const steps = progress.steps.map((s) => byId("step", s.id)).filter((t): t is Todo => t !== null);
  const goal = byId("goal", "goal");
  const rows = goal ? [...steps, goal] : steps;
  const data = progress.data.map((d) => byId("data", d.id)).filter((t): t is Todo => t !== null);
  // The item the call is on: the brain's pick while it is still pending, else the first pending step, else the goal.
  const pick = progress.now ? byId(progress.now.kind, progress.now.id) : null;
  const current = pick && !pick.done ? pick : (rows.find((t) => !t.done) ?? null);
  // Gone past: pending steps before the one the brain says the call is on.
  const at = current?.kind === "step" ? steps.findIndex((t) => t.key === current.key) : -1;
  const skipped = new Set(at > 0 ? steps.slice(0, at).filter((t) => !t.done).map((t) => t.key) : []);
  const fromBrain = current && progress.now && progress.now.kind === current.kind && progress.now.id === current.id ? progress.now.say?.trim() || null : null;
  const suggestion = fromBrain ?? (current?.kind === "data" ? current.ask : null);
  return { steps, rows, data, current, skipped, suggestion };
}

/** One line over the transcript: where the call is in the playbook, and a tap to open the steps. */
export function StepsLine() {
  const { ui, update, act, words } = useSay();
  const s = words.say.steps;
  const { steps, rows, current, skipped } = useStepRows();
  const covered = steps.filter((t) => t.done).length;
  // A step ticking while the sheet is closed pulses the line once (no count: a live "2/6" reads as a score of the rep).
  const last = useRef(covered);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (covered > last.current) setPulse((k) => k + 1);
    last.current = covered;
  }, [covered]);
  const open = ui.tab === "steps";
  const toggle = () => {
    if (!open) act({ name: "liveEvent", event: "open_steps" });
    update({ tab: open ? "transcript" : "steps", peek: null });
  };
  const gone = steps.filter((t) => skipped.has(t.key)).map((t) => t.label);
  const left = rows.filter((t) => !t.done && t.key !== current?.key && !skipped.has(t.key)).map((t) => t.label);
  let text: ReactNode;
  if (!current) text = <span className="say-line-now">{s.allDone}</span>;
  else {
    text = (
      <>
        <span className="say-line-now">{current.label}</span>
        {gone.length > 0 ? (
          <span className="say-line-skipped"> · {s.skippedLine(gone)}</span>
        ) : left.length > 0 ? (
          <span className="say-line-left"> · {s.left(left)}</span>
        ) : null}
      </>
    );
  }
  return (
    <button type="button" className="say-steps-line" data-open={open} data-skipped={gone.length > 0} title={s.help} aria-expanded={open} onClick={toggle}>
      {pulse > 0 && <span key={pulse} className="type-note-pulse say-line-pulse" aria-hidden />}
      <span className="say-dots" aria-hidden>
        {steps.map((t) => (
          <span key={t.key} className="say-dot" data-state={t.done ? "done" : t.key === current?.key ? "now" : skipped.has(t.key) ? "skipped" : "pending"} />
        ))}
      </span>
      <span className="say-line-text">{text}</span>
      <span className="say-line-chev" data-open={open}><ChevronRight size={8} /></span>
    </button>
  );
}

/** The steps over the transcript: what is left first, what is covered folded under it. */
export function StepsSheet() {
  const { live, ui, update, act, words } = useSay();
  const say = words.say;
  const s = say.steps;
  const progress = live.progress;
  const { rows, data, current, skipped, suggestion } = useStepRows();
  const [showCovered, setShowCovered] = useState(false);

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
  const asking = (todo: Todo) => Boolean(ui.askStep && ui.askStep.kind === todo.kind && ui.askStep.id === todo.id && !todo.done);
  const node = (todo: Todo) => (
    <button type="button" className="live-node" data-kind={todo.kind} title={todo.done ? words.untick : words.tick} aria-label={todo.done ? words.untick : words.tick} onClick={() => tick(todo)}>
      {todo.done ? <Check size={8} stroke={3.6} /> : todo.kind === "goal" ? <FlagIcon size={8} /> : null}
    </button>
  );

  const pending = rows.filter((t) => !t.done);
  // The step the call is on first, then the ones it went past, then the rest in the playbook's order.
  const order = (t: Todo) => (t.key === current?.key ? 0 : skipped.has(t.key) ? 1 : 2);
  const missing = [...pending].sort((a, b) => order(a) - order(b));
  const covered = rows.filter((t) => t.done);

  const nowRow = (todo: Todo) => {
    const step = todo.kind === "step" ? progress.steps.find((x) => x.id === todo.id) : null;
    const parts = step?.parts ?? [];
    return (
      <div key={todo.key} className="say-now-step" data-current="true">
        <div className="live-todo say-step" data-kind={todo.kind} data-done={false}>
          {node(todo)}
          <span className="say-now-label">{todo.label}</span>
          <span className="say-step-tag">{s.onNow}</span>
        </div>
        {step?.concept || step?.criterion ? <div className="say-now-concept">{step.concept ?? step.criterion}</div> : null}
        {parts.length > 0 && (
          <div className="say-parts">
            {parts.map((part) => (
              <span key={part.id} className="say-part" data-done={part.done} title={part.quote ?? ""}>
                {part.done && <Check size={8} stroke={3} />}
                {part.label}
              </span>
            ))}
            {step?.need && step.need < parts.length ? <span className="say-part-need">{say.enough(step.need, parts.length)}</span> : null}
          </div>
        )}
        {suggestion ? (
          <div className="say-now-q" title={say.suggestionHelp}>{suggestion}</div>
        ) : asking(todo) ? (
          <StepQuestion todo={todo} />
        ) : todo.kind !== "goal" ? (
          <button type="button" className="say-now-ask" onClick={() => ask(todo)}>{say.askThis}</button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="say-sheet" role="dialog" aria-label={s.label}>
      <div className="say-sheet-head">
        <span className="say-section">{s.missing}</span>
        <button type="button" className="live-close" title={s.close} aria-label={s.close} onClick={() => update({ tab: "transcript", askStep: null })}>
          <CloseSmall />
        </button>
      </div>
      <div className="say-steps-tab">
        {missing.length === 0 && <div className="dim say-line">{s.allDone}</div>}
        {missing.map((todo) =>
          todo.key === current?.key ? (
            nowRow(todo)
          ) : (
            <div key={todo.key} className="say-step-wrap">
              <div className="live-todo say-step" data-kind={todo.kind} data-done={false} data-skipped={skipped.has(todo.key)}>
                {node(todo)}
                {todo.kind !== "goal" ? (
                  <button type="button" className="say-step-label say-step-ask" title={todo.hint || say.askThis} onClick={() => ask(todo)}>
                    <span className="say-step-text">{todo.label}</span>
                  </button>
                ) : (
                  <span className="say-step-label" title={todo.hint}><span className="say-step-text">{todo.label}</span></span>
                )}
                {skipped.has(todo.key) && <span className="say-step-tag" data-kind="skipped">{s.skipped}</span>}
              </div>
              {asking(todo) && <StepQuestion todo={todo} />}
            </div>
          ),
        )}

        {data.length > 0 && (
          <div className="say-find" data-current={current?.kind === "data"}>
            <div className="say-section">{say.toFind}</div>
            <div className="say-chips">
              {data.map((todo) => (
                <button
                  key={todo.key}
                  type="button"
                  className="say-chip"
                  data-done={todo.done}
                  data-current={current?.key === todo.key}
                  title={todo.done ? (todo.byRep ? say.markedByYou : todo.detail ?? todo.hint) : todo.hint}
                  aria-pressed={todo.done}
                  onClick={() => tick(todo)}
                >
                  {todo.done && <Check size={8} stroke={3} />}
                  <span>{todo.label}</span>
                </button>
              ))}
            </div>
            {current?.kind === "data" && suggestion ? <div className="say-now-q" title={say.suggestionHelp}>{suggestion}</div> : null}
          </div>
        )}

        {covered.length > 0 && (
          <div className="say-covered">
            <button type="button" className="say-covered-head" aria-expanded={showCovered} onClick={() => setShowCovered((v) => !v)}>
              <span className="say-section">{s.covered(covered.length)}</span>
              <span className="say-line-chev" data-open={showCovered}><ChevronRight size={8} /></span>
            </button>
            {showCovered &&
              covered.map((todo) => (
                <div key={todo.key} className="say-step-wrap">
                  <div className="live-todo say-step" data-kind={todo.kind} data-done={true}>
                    {node(todo)}
                    <span className="say-step-label"><span className="say-step-text">{todo.label}</span></span>
                  </div>
                  {(todo.byRep || todo.detail) && <div className="say-covered-why">{todo.byRep ? say.markedByYou : `«${todo.detail}»`}</div>}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
