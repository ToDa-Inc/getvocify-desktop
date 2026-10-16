// Conversación: lead the call. Ahora, Falta (each with what to ask), Hecho. It draws whatever the playbook has: ordered
// steps, only data to find out, or no playbook at all.
import { Check, ChevronDown } from "../icons.tsx";
import { Empty, NowCard, OfflineLine } from "./cards.tsx";
import { useLive } from "./context.ts";
import { FollowScroll } from "./FollowScroll.tsx";
import { FlagIcon } from "./icons.tsx";
import { nowTodo, todos, type Todo } from "./model.ts";

const TODO_SHOWN = 3;

export function ConversationView() {
  const { live, ui, update, words, liveHelp, still, act, state } = useLive();
  if (!liveHelp) return <Empty text={words.helpOff} />;
  const progress = live.progress;
  const all = todos(progress, ui.marks, words);
  const pending = all.filter((x) => !x.done);
  const now = nowTodo(progress, ui.marks, words);
  const todo = pending.filter((x) => x.key !== now?.key);
  const done = all.filter((x) => x.done);
  const shown = ui.todoOpen ? todo : todo.slice(0, TODO_SHOWN);
  const name = progress.playbook.name ?? state.typeMenu?.title ?? "";
  const tick = (x: Todo) => {
    update({ marks: { ...ui.marks, [x.key]: !x.done }, askId: ui.askId === x.key ? null : ui.askId });
    act({ name: "liveTick", kind: x.kind, id: x.id, on: !x.done });
  };
  return (
    <div className="live-conv">
      {live.offlineSince !== null && <OfflineLine since={live.offlineSince} />}
      <FollowScroll follow={false} still={still}>
        {/* A new playbook (the type changed) comes in as a whole, not row by row. */}
        <div className="live-conv-body" key={`${progress.playbook.key}|${progress.hasPlaybook}|${progress.steps.length}`}>
          <div className="live-path-head">
            <span className="live-path-name">{name}</span>
            {progress.hasPlaybook && all.length > 0 && (
              <>
                <span className="live-bar" aria-hidden><span style={{ width: `${Math.round((done.length / all.length) * 100)}%` }} /></span>
                <span className="live-path-count">{words.progress(done.length, all.length)}</span>
              </>
            )}
          </div>

          {!progress.hasPlaybook ? (
            <div className="live-noplaybook">
              <div className="lost-title">{words.noPlaybook(name)}</div>
              <div className="lost-body">{words.knowledgeOnly}</div>
            </div>
          ) : (
            <>
              {now && <NowCard now={now} onTick={() => tick(now)} />}

              {todo.length > 0 && (
                <div className="live-list">
                  <div className="group-label live-list-head">{words.missing} · {todo.length}</div>
                  {shown.map((x) => (
                    <TodoRow key={x.key} x={x} open={ui.askId === x.key} onTick={() => tick(x)} onOpen={() => update({ askId: ui.askId === x.key ? null : x.key })} />
                  ))}
                  {todo.length > TODO_SHOWN && (
                    <button type="button" className="live-more" onClick={() => update({ todoOpen: !ui.todoOpen })}>
                      {ui.todoOpen ? words.less : words.more(todo.length - TODO_SHOWN)}
                    </button>
                  )}
                </div>
              )}

              {done.length > 0 && (
                <div className="live-list live-done" data-open={ui.doneOpen}>
                  <button type="button" className="live-section-toggle" aria-expanded={ui.doneOpen} onClick={() => update({ doneOpen: !ui.doneOpen })}>
                    <span>{words.done} · {done.length}</span>
                    <ChevronDown size={7} stroke={3.6} />
                  </button>
                  <div className="live-fold">
                    <div className="live-fold-body">
                      {done.map((x) => (
                        <div key={x.key} className="live-todo" data-done="true" data-kind={x.kind}>
                          <button type="button" className="live-node" data-kind={x.kind} title={words.untick} aria-label={words.untick} onClick={() => tick(x)}>
                            <Check size={8} stroke={3.6} />
                          </button>
                          <span className="live-todo-label">{x.label}</span>
                          <span className="live-todo-detail" title={x.byRep ? words.markedByYou : x.detail ?? ""}>{x.byRep ? words.markedByYou : x.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </FollowScroll>
    </div>
  );
}

/** A point still missing: its node ticks it; its name opens what to ask for it. */
function TodoRow({ x, open, onTick, onOpen }: { x: Todo; open: boolean; onTick: () => void; onOpen: () => void }) {
  const { words } = useLive();
  return (
    <div className="live-todo-wrap" data-open={open}>
      <div className="live-todo" data-kind={x.kind}>
        <button type="button" className="live-node" data-kind={x.kind} title={words.tick} aria-label={words.tick} onClick={onTick}>
          {x.kind === "goal" && <FlagIcon size={8} />}
        </button>
        <button type="button" className="live-todo-open" title={x.ask ? words.whatToAsk : x.hint} aria-expanded={x.ask ? open : undefined} onClick={x.ask ? onOpen : undefined} disabled={!x.ask}>
          <span className="live-todo-label">{x.label}</span>
          {x.ask && <ChevronDown size={7} stroke={3.6} />}
        </button>
      </div>
      {x.ask && (
        <div className="live-fold">
          <div className="live-fold-body">
            <div className="live-todo-ask">«{x.ask}»</div>
          </div>
        </div>
      )}
    </div>
  );
}
