// Pasos, the tab under Qué decir: ONE list (2026-11-16). The call type at the top (where the island sizes itself), then
// the playbook's steps in its order as equal rows, ticking themselves as the call covers them (or by the rep's tap on the
// circle): done, the one the call is on («Ahora», its row lit), pending. A tap on a pending step opens it under its own
// row (what it asks, its parts as they are heard) and asks for a question from this call; the step the call is on already
// has the brain's own. One row open at a time. Never the playbook's example sentence: that is another prospect's words,
// and read out word for word it is a script. What to find out is one more row of the list, with how many are known; a
// tap opens its chips under it, which tick themselves with what they said inside. The card above is the brain's alone:
// nothing pressed here changes it.
import { useEffect, useRef, useState } from "react";
import { Check } from "../icons.tsx";
import { nowMs } from "../useNow.ts";
import { ChevronRight, FlagIcon, QuestionIcon } from "../live/icons.tsx";
import { todos, type Todo } from "../live/model.ts";
import { useSay } from "./context.ts";
import { StepQuestion } from "./Peeks.tsx";

export function StepsTab() {
  const { live, ui, update, act, words, typeControl } = useSay();
  const say = words.say;
  const progress = live.progress;
  const [open, setOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = todos(progress, ui.marks, words);
  const byId = (kind: Todo["kind"], id: string) => all.find((t) => t.kind === kind && t.id === id) ?? null;
  const steps = progress.steps.map((s) => byId("step", s.id)).filter((t): t is Todo => t !== null);
  const goal = byId("goal", "goal");
  const rows = goal ? [...steps, goal] : steps;
  const data = progress.data.map((d) => byId("data", d.id)).filter((t): t is Todo => t !== null);
  const pick = progress.now ? byId(progress.now.kind, progress.now.id) : null;
  const current = pick && !pick.done ? pick : (rows.find((t) => !t.done) ?? null);
  const fromBrain = current && progress.now && progress.now.kind === current.kind && progress.now.id === current.id ? progress.now.say?.trim() || null : null;

  // The step the call is on stays in view when it moves on. The list scrolls itself: scrolling into view would move the panels.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>("[data-now='true']");
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 6);
  }, [current?.key]);

  const tick = (todo: Todo) => {
    update({ marks: { ...ui.marks, [todo.key]: !todo.done } });
    act({ name: "liveTick", kind: todo.kind, id: todo.id, on: !todo.done });
  };
  const toggle = (todo: Todo) => {
    if (open === todo.key) {
      setOpen(null);
      return update({ askStep: null });
    }
    setOpen(todo.key);
    const hasQuestion = current?.key === todo.key && fromBrain;
    if (todo.done || todo.kind === "goal" || hasQuestion) return update({ askStep: null });
    act({ name: "liveAskStep", kind: todo.kind, id: todo.id });
    update({ askStep: { kind: todo.kind as "step" | "data", id: todo.id, after: live.asks.step?.seq ?? 0, at: nowMs() } });
  };
  const known = data.filter((t) => t.done).length;
  // Open on its own while what the call is on is something to find out; else when the rep opens it.
  const findOpen = ui.find || current?.kind === "data";
  const asking = (todo: Todo) => Boolean(ui.askStep && ui.askStep.kind === todo.kind && ui.askStep.id === todo.id && !todo.done);

  return (
    <div className="say-steps-tab" ref={listRef}>
      {typeControl && <div className="say-type-row">{typeControl}</div>}
      {rows.map((todo) => {
        const now = current?.key === todo.key;
        const isOpen = open === todo.key;
        const step = todo.kind === "step" ? progress.steps.find((s) => s.id === todo.id) : null;
        const parts = step?.parts ?? [];
        return (
          <div key={todo.key} className="say-row" data-open={isOpen} data-now={now} data-done={todo.done}>
            <div className="live-todo say-step" data-kind={todo.kind} data-done={todo.done}>
              <button type="button" className="live-node" data-kind={todo.kind} title={todo.done ? words.untick : words.tick} aria-label={todo.done ? words.untick : words.tick} onClick={() => tick(todo)}>
                {todo.done ? <Check size={8} stroke={3.6} /> : todo.kind === "goal" ? <FlagIcon size={8} /> : null}
              </button>
              <button type="button" className="say-row-main" aria-expanded={isOpen} onClick={() => toggle(todo)}>
                <span className={now ? "say-step-text say-now-label" : "say-step-text"}>{todo.label}</span>
                {now && <span className="say-now-mark">{say.now}</span>}
                <span className="grow" />
                {!todo.done && todo.kind !== "goal" && (
                  <span className="say-row-q">
                    <QuestionIcon size={11} />
                    <span>{say.question}</span>
                  </span>
                )}
              </button>
            </div>
            {isOpen && (
              <div className="say-row-body">
                {todo.done ? (
                  <div className="say-now-concept">{todo.byRep ? say.markedByYou : todo.detail ?? say.markedByYou}</div>
                ) : (
                  <>
                    {step?.concept || step?.criterion ? <div className="say-now-concept">{step.concept ?? step.criterion}</div> : null}
                    {parts.length > 0 && (
                      <div className="say-parts">
                        {parts.map((part) => (
                          <span key={part.id} className="say-part" data-done={part.done}>
                            {part.done && <Check size={8} stroke={3} />}
                            {part.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {now && fromBrain ? <div className="say-now-q">{fromBrain}</div> : asking(todo) ? <StepQuestion todo={todo} /> : null}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {data.length > 0 && (
        <div className="say-row say-find" data-current={current?.kind === "data"} data-open={findOpen}>
          <div className="live-todo say-find-head" data-done={known === data.length}>
            <span className="live-node" data-kind="data">{known === data.length ? <Check size={8} stroke={3.6} /> : null}</span>
            <button type="button" className="say-row-main" aria-expanded={findOpen} onClick={() => update({ find: !findOpen, askStep: null })}>
              <span className="say-step-text">{say.toFind}</span>
              <span className="say-find-count">{known}/{data.length}</span>
              <span className="grow" />
              <span className="say-find-chevron"><ChevronRight size={8} /></span>
            </button>
          </div>
          {findOpen && (<>
          <div className="say-chips">
            {data.map((todo) => {
              const value = progress.data.find((d) => d.id === todo.id)?.value ?? null;
              return (
                <button key={todo.key} type="button" className="say-chip" data-done={todo.done} data-current={current?.key === todo.key} title={todo.hint} aria-pressed={todo.done} onClick={() => tick(todo)}>
                  {todo.done && <Check size={8} stroke={3} />}
                  <span>{todo.label}</span>
                  {todo.done && value ? <span className="say-chip-value">{value}</span> : null}
                </button>
              );
            })}
          </div>
          {current?.kind === "data" && (fromBrain ?? current.ask) ? <div className="say-now-q" title={say.suggestionHelp}>{fromBrain ?? current.ask}</div> : null}
          </>)}
        </div>
      )}
    </div>
  );
}
