// Pasos, the default tab under Qué decir: the playbook's steps in its order, ticking themselves as the call covers them (or
// by the rep's tap on the circle). Only the step that matters now is open: what it asks, its parts as they are heard, and the
// brain's question from this call when it has one. Never the playbook's example sentence: that is another prospect's words,
// and read out word for word it is a script. What to find out sits under the steps as chips that tick themselves too.
import { useEffect, useRef } from "react";
import { Check } from "../icons.tsx";
import { nowMs } from "../useNow.ts";
import { FlagIcon } from "../live/icons.tsx";
import { todos, type Todo } from "../live/model.ts";
import { useSay } from "./context.ts";
import { StepQuestion } from "./Peeks.tsx";

export function StepsTab() {
  const { live, ui, update, act, words } = useSay();
  const say = words.say;
  const progress = live.progress;
  const listRef = useRef<HTMLDivElement>(null);
  const all = todos(progress, ui.marks, words);
  const byId = (kind: Todo["kind"], id: string) => all.find((t) => t.kind === kind && t.id === id) ?? null;
  // The playbook's order, not the brain's: this is the "guion" a team already has. The goal comes last.
  const steps = progress.steps.map((s) => byId("step", s.id)).filter((t): t is Todo => t !== null);
  const goal = byId("goal", "goal");
  const rows = goal ? [...steps, goal] : steps;
  const data = progress.data.map((d) => byId("data", d.id)).filter((t): t is Todo => t !== null);

  // The current item: the brain's pick while it is still pending, else the first pending step, else the goal.
  const pick = progress.now ? byId(progress.now.kind, progress.now.id) : null;
  const current = pick && !pick.done ? pick : (rows.find((t) => !t.done) ?? null);
  // The brain's question for it, from this call. A data item without one has the question written from its good answer.
  const fromBrain = current && progress.now && progress.now.kind === current.kind && progress.now.id === current.id ? progress.now.say?.trim() || null : null;
  const suggestion = fromBrain ?? (current?.kind === "data" ? current.ask : null);

  // The current step stays in view when it moves on. The list scrolls itself: scrolling into view would move the panels.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>("[data-current='true']");
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 6);
  }, [current?.key]);

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

  return (
    <div className="say-steps-tab" ref={listRef}>
      {rows.map((todo) => {
        if (current && todo.key === current.key) {
          const step = todo.kind === "step" ? progress.steps.find((s) => s.id === todo.id) : null;
          const parts = step?.parts ?? [];
          return (
            <div key={todo.key} className="say-now-step" data-current="true">
              <div className="live-todo say-step" data-kind={todo.kind} data-done={false}>
                {node(todo)}
                <span className="say-now-label">{todo.label}</span>
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
        }
        return (
          <div key={todo.key} className="say-step-wrap">
            <div className="live-todo say-step" data-kind={todo.kind} data-done={todo.done}>
              {node(todo)}
              {!todo.done && todo.kind !== "goal" ? (
                <button type="button" className="say-step-label say-step-ask" title={todo.hint || say.askThis} onClick={() => ask(todo)}>
                  <span className="say-step-text">{todo.label}</span>
                </button>
              ) : (
                <span className="say-step-label" title={todo.done ? (todo.byRep ? say.markedByYou : todo.detail ?? "") : todo.hint}>
                  <span className="say-step-text">{todo.label}</span>
                </span>
              )}
            </div>
            {asking(todo) && <StepQuestion todo={todo} />}
          </div>
        );
      })}

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
    </div>
  );
}
