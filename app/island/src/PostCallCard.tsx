import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { ArrowUpRight, Calendar, Check, ChevronDown, Close, ExclamationCircle, FileText, IdCard, Mail, PhoneDown, Plus, Users } from "./icons.tsx";
import { dayAfter, dueLabel, dueOfMoment, type TaskDue } from "../../core/taskDates.ts";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";
import { TaskDatePicker } from "./TaskDatePicker.tsx";
import { postCallCrmName, type IslandAction, type PostCallChange, type PostCallData, type PostCallMeeting } from "./types.ts";

/**
 * The after-call card: a port of `PostCallMenu` (MeetingPill.swift) with its layout numbers (`PostCallLayout`).
 * CRM / Email / Notes tabs; the changes grouped by record, every one ticked until the rep unticks it; a value with options opens a floating list,
 * free text is edited in Vocify (the dashboard only takes values from a field's options); the note is edited here and
 * saved with the update.
 */

type Act = (action: IslandAction) => void;
type Tab = "crm" | "email" | "notes";
/** A task the rep added here: its title, the day it is due (YYYY-MM-DD, the rep's own calendar) and, when chosen, the hour. */
type NewTask = { title: string; due: string; time: string | null };
/** What the rep changed on one of the call's proposed tasks: its text, and/or its day and hour. */
type TaskEdit = { title?: string; due?: string; time?: string | null };

const L = { inset: 16, top: 6, header: 26, tabs: 26, gap: 8, line: 30, groupLabel: 20, listMax: 236, actions: 40, meeting: 26, bottom: 10, label: 104, noteLines: 8, noteMinLines: 3 } as const;
const GROUPS = [
  { object: "contact", title: "Contact" },
  { object: "company", title: "Company" },
  { object: "deal", title: "Deal" },
  { object: "other", title: "Other" },
];

/** The changes the card lists, by record. */
function groupedChanges(postCall: PostCallData) {
  return GROUPS.flatMap((group) => {
    const changes = postCall.changes.filter((c) => c.object === group.object || (group.object === "other" && !["contact", "company", "deal"].includes(c.object)));
    return changes.length ? [{ title: group.title, changes }] : [];
  });
}

function pickedValues(change: PostCallChange, edited: string | undefined): string[] {
  const raw = edited ?? change.value;
  return change.multiple ? raw.split(";").map((v) => v.trim()).filter(Boolean) : [raw];
}

/** What the value reads as: the picked options' labels, or the text (as typed, when the rep edited it). */
function shownValue(change: PostCallChange, edited: string | undefined): string {
  if (edited === undefined) return change.pending ? "Choose…" : change.to;
  if (change.options.length === 0) return edited;
  const labels = pickedValues(change, edited).map((v) => change.options.find((o) => o.value === v)?.label ?? v);
  return labels.length ? labels.join(", ") : "—";
}

export function PostCallCard({ postCall, act, onPopupExtent }: { postCall: PostCallData; act: Act; /** Where an open dropdown ends (px from the window's top), or null: the window grows to include it. */ onPopupExtent: (bottom: number | null) => void }) {
  // What the rep unticked. Everything else is written: a change that arrives after the card opened is ticked too.
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("crm");
  const [options, setOptions] = useState<{ key: string; anchor: Anchor } | null>(null);
  const [typeMenu, setTypeMenu] = useState<Anchor | null>(null);
  const [tasks, setTasks] = useState<NewTask[]>([]);
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEdit>>({});
  const [dateMenu, setDateMenu] = useState<{ key: string; anchor: Anchor } | null>(null);

  // A new call: its own ticks, picks and note.
  useEffect(() => {
    setDropped(new Set());
    setEdited({});
    setNoteDraft(null);
    setActiveTab("crm");
    setOptions(null);
    setTypeMenu(null);
    setTasks([]);
    setTaskEdits({});
    setDateMenu(null);
  }, [postCall.memoId]);

  // Past its changes (applying, done...), a value's options no longer apply.
  useEffect(() => {
    if (postCall.stage !== "ready") {
      setOptions(null);
      setDateMenu(null);
    }
  }, [postCall.stage]);

  const groups = groupedChanges(postCall);
  const nothingSure = groups.length === 0;
  const noteEditable = postCall.stage === "ready" && postCall.canApprove;
  const noteText = noteDraft ?? postCall.summary ?? "";
  const tabs: Tab[] = ["crm"];
  if (postCall.email) tabs.push("email");
  if (!postCall.noAnswer && (postCall.notes || postCall.summary !== null || noteEditable)) tabs.push("notes");
  const tab = tabs.includes(activeTab) ? activeTab : "crm";
  // A change with nothing proposed (the lead status) is written only once the rep has picked a value for it.
  const isKept = (key: string) => !dropped.has(key) && !(postCall.changes.find((c) => c.key === key)?.pending && edited[key] === undefined);
  const keptCount = postCall.changes.filter((c) => isKept(c.key)).length;
  const hasNote = noteDraft !== null && noteDraft.trim() !== "";
  const canSave = keptCount > 0 || hasNote || tasks.length > 0;
  const crm = postCallCrmName(postCall);

  // The island never takes the keyboard (a click must not take it from the call), except while this card can still save:
  // then its note and its free-text values can be typed in, and a click in them focuses the window like any text field.
  const typable = postCall.stage === "ready" && postCall.canApprove;
  useEffect(() => {
    if (!typable) return;
    void window.vocifyIsland?.keyboard?.("available");
    return () => void window.vocifyIsland?.keyboard?.("off");
  }, [typable]);

  const closeMenus = useCallback(() => {
    setOptions(null);
    setTypeMenu(null);
    setDateMenu(null);
  }, []);

  const toggleChange = (key: string) =>
    setDropped((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const keep = (key: string) =>
    setDropped((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });

  /** A checkbox list stays open for more ticks; a list of one closes on the pick. Picking also ticks the change. */
  const pick = (value: string, change: PostCallChange) => {
    let next = value;
    if (change.multiple) {
      const values = pickedValues(change, edited[change.key]);
      next = (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]).join(";");
    }
    setEdited((previous) => ({ ...previous, [change.key]: next }));
    keep(change.key);
    if (!change.multiple) setOptions(null);
  };

  /** Like the Mac app: what is not ticked is left out, and only values the rep changed are sent as edits. */
  const approve = () => {
    const omit = postCall.changes.map((c) => c.key).filter((key) => !isKept(key));
    if (!canSave) return;
    const edits = Object.fromEntries(Object.entries(edited).filter(([key, value]) => postCall.changes.some((c) => c.key === key && c.value !== value)));
    // Only the tasks still ticked, and only what changed on them (a time left out is "any hour").
    const moved = Object.fromEntries(
      Object.entries(taskEdits)
        .filter(([key]) => !omit.includes(key) && postCall.changes.some((c) => c.key === key))
        .map(([key, edit]) => [key, { ...(edit.title !== undefined ? { title: edit.title } : {}), ...(edit.due ? { due: edit.due, ...(edit.time ? { time: edit.time } : {}) } : {}) }]),
    );
    const added = tasks.map((task) => ({ title: task.title, due: task.due, ...(task.time ? { time: task.time } : {}) }));
    act({ name: "postCall", type: "approve", details: { omit, edits, ...(noteDraft !== null ? { note: noteDraft } : {}), ...(added.length > 0 ? { tasks: added } : {}), ...(Object.keys(moved).length > 0 ? { taskEdits: moved } : {}) } });
  };

  const send = (type: string, details?: Record<string, unknown>) => act({ name: "postCall", type, details });
  // A call nobody answered has nothing to review in Vocify.
  const review = postCall.noAnswer ? null : <TextAction title="Review in Vocify" arrow onClick={() => send("review")} />;
  const saveButton = (
    <button type="button" className="primary-action" disabled={!canSave} title={`Writes the ticked changes, the new tasks and the note to ${crm}`} onClick={approve}>
      <Check size={9} />
      <span>{saveLabel(keptCount + tasks.length, hasNote, postCall.crm ?? "the CRM", postCall.noAnswer)}</span>
    </button>
  );

  const count = (t: Tab) => (t === "crm" ? (postCall.stage === "ready" ? keptCount : postCall.stage === "review" ? 1 : 0) : t === "email" && postCall.email?.state === "ready" ? 1 : 0);

  return (
    <>
      <div className="postcall-card" style={{ padding: `${L.top}px ${L.inset}px ${L.bottom}px` }}>
        <div className="postcall-header" style={{ height: L.header }}>
          <span className="postcall-title">{postCall.contactName ?? "Your call"}</span>
          {postCall.type &&
            (postCall.type.options.length === 0 ? (
              <span className="type-tag" title="What this call was scored as">{postCall.type.label}</span>
            ) : (
              <button
                type="button"
                className="type-tag"
                title="What this call was scored as. Change it to score it again."
                onClick={(event) => {
                  event.stopPropagation();
                  const target = event.currentTarget;
                  setOptions(null);
                  setTypeMenu((open) => (open ? null : anchorOf(target)));
                }}
              >
                <span className="type-tag-label">{postCall.type.label}</span>
                <ChevronDown size={7} stroke={3.6} />
              </button>
            ))}
          <div className="grow" />
          <button type="button" className="icon-button" title="Done" aria-label="Done" onClick={() => send("dismiss")}>
            <Close size={11} />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="postcall-tabs" role="tablist" style={{ height: L.tabs, margin: `${L.gap}px 0` }}>
            {tabs.map((t) => (
              <TabButton key={t} tab={t} active={t === tab} count={count(t)} busy={t === "email" && postCall.email?.state === "writing"} onClick={() => { setActiveTab(t); closeMenus(); }} />
            ))}
          </div>
        )}

        {tab === "crm" && (
          <>
            {postCall.noAnswer && postCall.stage === "ready" && (
              <Line icon={<PhoneDown size={11} />}><span className="dim">No answer. Logged in {crm} as no answer</span></Line>
            )}
            {postCall.stage === "writing" && <Line busy><span className="dim">Writing the update…</span></Line>}
            {postCall.stage === "ready" && nothingSure && (
              <Line icon={<ExclamationCircle />} trailing={postCall.canApprove ? undefined : review}>
                <span>Nothing clear enough to write from here</span>
              </Line>
            )}
            {postCall.stage === "ready" && nothingSure && postCall.canApprove && (
              <>
                <AddTask tasks={tasks} onChange={setTasks} onPopupExtent={onPopupExtent} />
                <div className="postcall-actions" style={{ height: L.actions }}>
                  {saveButton}
                  <div className="grow" />
                  {review}
                </div>
              </>
            )}
            {postCall.stage === "ready" && !nothingSure && (
              <>
                <ChangesList>
                  {groups.map((group) => (
                    <div key={group.title}>
                      <div className="group-label" style={{ height: L.groupLabel }}>{group.title}</div>
                      {group.changes.map((change) => (
                        <ChangeRow
                          key={change.key}
                          change={change}
                          shown={change.when !== null ? taskEdits[change.key]?.title ?? change.to : shownValue(change, edited[change.key])}
                          kept={isKept(change.key)}
                          open={options?.key === change.key}
                          toggle={() => toggleChange(change.key)}
                          editable={typable && (change.editable || change.when !== null)}
                          taskEdit={change.when !== null ? taskEdits[change.key] ?? {} : null}
                          dateOpen={dateMenu?.key === change.key}
                          onDate={(element) => {
                            setOptions(null);
                            setTypeMenu(null);
                            setDateMenu((open) => (open?.key === change.key ? null : { key: change.key, anchor: anchorOf(element) }));
                          }}
                          onEdit={(text) => {
                            if (change.when !== null) setTaskEdits((previous) => ({ ...previous, [change.key]: { ...previous[change.key], title: text } }));
                            else setEdited((previous) => ({ ...previous, [change.key]: text }));
                            keep(change.key);
                          }}
                          toggleOptions={(element) => {
                            setTypeMenu(null);
                            setOptions((open) => (open?.key === change.key ? null : { key: change.key, anchor: anchorOf(element) }));
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </ChangesList>
                {postCall.canApprove && <AddTask tasks={tasks} onChange={setTasks} onPopupExtent={onPopupExtent} />}
                <div className="postcall-actions" style={{ height: L.actions }}>
                  {postCall.canApprove ? (
                    <>
                      {saveButton}
                      <div className="grow" />
                      {review}
                    </>
                  ) : (
                    <>
                      {/* No contact on this recording: Vocify's review has the contact picker, and saves from there. */}
                      <button type="button" className="primary-action" title={`Pick who it was with in Vocify, then save to ${crm}`} onClick={() => send("chooseContact")}>
                        <ArrowUpRight size={9} stroke={2.6} />
                        <span>Choose contact to save</span>
                      </button>
                      <div className="grow" />
                    </>
                  )}
                </div>
              </>
            )}
            {postCall.stage === "applying" && (
              <div className="applying">
                <Line busy trailing={<button type="button" className="small-action" onClick={() => send("undo")}>Undo</button>}>
                  <span>Updating {postCall.contactName ?? "the contact"} in {crm}…</span>
                </Line>
                {postCall.undoUntil !== null && <UndoLine until={postCall.undoUntil} />}
              </div>
            )}
            {postCall.stage === "done" && (
              <Line icon={<Check size={10.5} stroke={3} />} trailing={postCall.crmUrl ? <TextAction title={`Open in ${crm}`} arrow onClick={() => send("openCrm")} /> : undefined}>
                <span>{postCall.applied === null ? `Updated in ${crm}` : postCall.applied === 0 ? `Note saved in ${crm}` : postCall.applied === 1 ? `1 field updated in ${crm}` : `${postCall.applied} fields updated in ${crm}`}</span>
              </Line>
            )}
            {postCall.stage === "internal" && <Line icon={<Users />}><span className="dim">Internal, nothing goes to the CRM</span></Line>}
            {postCall.stage === "review" && (
              <Line icon={<ExclamationCircle />} trailing={<TextAction title="Review" arrow onClick={() => send("review")} />}>
                <span>{postCall.note ?? "Needs a look"}</span>
              </Line>
            )}
            {postCall.meeting && postCall.stage !== "internal" && <MeetingRow meeting={postCall.meeting} onAdd={() => send("addMeeting")} onReview={() => send("review")} />}
          </>
        )}

        {tab === "email" && postCall.email && (
          <>
            {postCall.email.state === "writing" && (
              <Line busy><span className="dim">{postCall.email.to ? `Writing the email to ${postCall.email.to}…` : "Writing the follow-up email…"}</span></Line>
            )}
            {postCall.email.state === "ready" &&
              (postCall.email.subject !== null || postCall.email.preview !== null ? (
                <>
                  <div className="email-box" style={{ marginTop: L.gap }}>
                    {postCall.email.to && <div className="email-to">To {postCall.email.to}</div>}
                    <div className="email-subject">{postCall.email.subject ?? "Follow-up"}</div>
                    {postCall.email.preview && <div className="email-preview">{postCall.email.preview}</div>}
                  </div>
                  <div className="postcall-actions" style={{ height: L.actions }}>
                    <button type="button" className="primary-action" title="Opens the email in Vocify to send it" onClick={() => send("openEmail")}>
                      <ArrowUpRight size={9} stroke={2.6} />
                      <span>Open draft</span>
                    </button>
                    <TextAction title="Skip" onClick={() => send("skipEmail")} />
                    <div className="grow" />
                  </div>
                </>
              ) : (
                <Line
                  icon={<Mail size={10.5} />}
                  trailing={
                    <>
                      <button type="button" className="small-action" onClick={() => send("openEmail")}>Open</button>
                      <button type="button" className="small-action" onClick={() => send("skipEmail")}>Skip</button>
                    </>
                  }
                >
                  <span>{postCall.email.to ? `Email to ${postCall.email.to} ready` : "Email ready"}</span>
                </Line>
              ))}
            {postCall.email.state === "skipped" && (
              <Line icon={<Mail size={10.5} />} trailing={<button type="button" className="small-action" onClick={() => send("unskipEmail")}>Undo</button>}>
                <span className="dim">Email skipped</span>
              </Line>
            )}
            {postCall.email.state === "sent" && <Line icon={<Check size={10.5} stroke={3} />}><span className="dim">Email sent</span></Line>}
          </>
        )}

        {tab === "notes" && (
          <>
            {(noteEditable || noteText !== "") && (
              <NoteBox editable={noteEditable} text={noteText} placeholder={`Add a note for ${crm}`} onChange={setNoteDraft} />
            )}
            <div className="postcall-actions" style={{ height: L.actions }}>
              {noteEditable ? (
                saveButton
              ) : null}
              <div className="grow" />
              <TextAction title="Open in Vocify" arrow onClick={() => send("openNotes")} />
            </div>
          </>
        )}
      </div>

      {options && (() => {
        const change = postCall.changes.find((c) => c.key === options.key);
        if (!change) return null;
        const selected = pickedValues(change, edited[change.key]);
        return (
          <FloatMenu anchor={options.anchor} width={Math.max(160, Math.round(options.anchor.width) + 8)} onClose={closeMenus} onExtent={onPopupExtent} label={change.label}>
            {change.options.map((option) => (
              <MenuRow key={option.value} label={option.label} selected={selected.includes(option.value)} onPick={() => pick(option.value, change)} />
            ))}
          </FloatMenu>
        );
      })()}
      {typeMenu && postCall.type && postCall.type.options.length > 0 && (
        <FloatMenu anchor={typeMenu} width={190} onClose={closeMenus} onExtent={onPopupExtent} label="Call type">
          {[{ key: postCall.type.key, label: postCall.type.label }, ...postCall.type.options.filter((o) => o.key !== postCall.type?.key)].map((option) => (
            <MenuRow
              key={option.key}
              label={option.label}
              selected={postCall.type?.key === option.key}
              onPick={() => {
                send("setType", { key: option.key });
                setTypeMenu(null);
              }}
            />
          ))}
        </FloatMenu>
      )}
      {dateMenu && (() => {
        const change = postCall.changes.find((c) => c.key === dateMenu.key);
        if (!change) return null;
        const edit = taskEdits[change.key];
        const value: TaskDue = edit?.due ? { due: edit.due, time: edit.time ?? null } : dueOfMoment(change.dueAt) ?? { due: dayAfter(1), time: null };
        return (
          <TaskDatePicker
            anchor={dateMenu.anchor}
            value={value}
            onClose={closeMenus}
            onExtent={onPopupExtent}
            onChange={(next) => {
              setTaskEdits((previous) => ({ ...previous, [change.key]: { ...previous[change.key], due: next.due, time: next.time } }));
              keep(change.key);
            }}
          />
        );
      })()}
    </>
  );
}

/** The Save button: the ticked fields and/or the note, whichever the rep has. */
function saveLabel(fields: number, note: boolean, crm: string, noAnswer = false): string {
  if (fields > 0) return `Save ${fields}${note ? " + note" : ""} to ${crm}`;
  if (noAnswer) return `Save to ${crm}`;
  return note ? `Save note to ${crm}` : "Nothing to save";
}

/** CRM / Email / Notes, each with what it still needs from the rep. */
function TabButton({ tab, active, count, busy, onClick }: { tab: Tab; active: boolean; count: number; busy: boolean; onClick: () => void }) {
  const title = tab === "crm" ? "CRM" : tab === "email" ? "Email" : "Notes";
  return (
    <button type="button" role="tab" aria-selected={active} aria-label={count > 0 ? `${title}, ${count}` : title} className="postcall-tab" data-active={active} onClick={onClick}>
      {tab === "crm" ? <IdCard /> : tab === "email" ? <Mail /> : <FileText />}
      <span>{title}</span>
      {busy ? <span className="spinner spinner-small" /> : count > 0 && <span className="tab-badge">{count}</span>}
    </button>
  );
}

/** One row of the card: an icon (or progress), the text, and its actions on the right. */
function Line({ icon, busy = false, trailing, children }: { icon?: ReactNode; busy?: boolean; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="postcall-line" style={{ height: L.line }}>
      <span className="line-icon">{busy ? <span className="spinner" /> : icon}</span>
      <span className="line-text">{children}</span>
      <div className="grow" />
      {trailing}
    </div>
  );
}

function TextAction({ title, arrow = false, onClick }: { title: string; arrow?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="text-action" onClick={onClick}>
      {arrow && <ArrowUpRight size={10} stroke={2.4} />}
      <span>{title}</span>
    </button>
  );
}

/** The changes, up to `listMax` tall; a longer list scrolls and fades out at its bottom edge instead of cutting a row. */
function ChangesList({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setScrolls(el.scrollHeight > el.clientHeight + 1);
  });
  return (
    <div ref={ref} className="changes-list" data-scrolls={scrolls} style={{ maxHeight: L.listMax }}>
      {children}
    </div>
  );
}

/** One proposed change: tick to keep, its field, and what it becomes (then what it was). */
function ChangeRow({ change, shown, kept, open, toggle, toggleOptions, editable, onEdit, taskEdit, dateOpen, onDate }: { change: PostCallChange; shown: string; kept: boolean; open: boolean; toggle: () => void; toggleOptions: (element: Element) => void; editable: boolean; onEdit: (text: string) => void; /** The edits on this task, or null when the row is not a task. */ taskEdit: TaskEdit | null; dateOpen: boolean; onDate: (element: Element) => void }) {
  const value = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const before = change.from !== null && change.from !== shown ? change.from : null;
  const hasOptions = change.options.length > 0;
  return (
    <div className="change-row">
      <button type="button" className="change-toggle" title={kept ? (change.check ? "Vocify was less sure of this one. Untick to leave it out" : "Untick to leave it out") : "Tick to write it"} aria-label={change.label} aria-pressed={kept} onClick={toggle}>
        <span className="tick" data-kept={kept}>{kept && <Check size={7.5} stroke={4} />}</span>
        <span className="change-label" style={{ width: L.label }}>{change.label}</span>
      </button>
      <div
        ref={value}
        className="change-value"
        data-open={open}
        title={hasOptions ? (change.multiple ? "Pick one or more" : "Pick another value") : editable ? "Edit the text" : "Edit it in Vocify"}
        onMouseEnter={editable && !hasOptions ? keyboardOver : undefined}
        // On the press, before the text box opens: the keyboard is the island's by the time the caret goes in.
        onMouseDown={editable && !hasOptions ? keyboardNow : undefined}
        onMouseLeave={editable && !hasOptions ? releaseKeyboardSoon : undefined}
        onClick={(event) => {
          if (!hasOptions) return editable ? setEditing(true) : toggle();
          event.stopPropagation();
          if (value.current) toggleOptions(value.current);
        }}
      >
        {editing ? (
          <ValueEditor text={shown} onDone={(text) => {
            setEditing(false);
            if (text !== null && text.trim() !== "" && text !== shown) onEdit(text.trim());
          }} />
        ) : (
          <span className="value-body">
            <span className="value-text">
              <span data-kept={kept}>{shown}</span>
              {before !== null && <span className="was-text">{"  was "}{before}</span>}
            </span>
            {/* Outside the clamped text, so a long task never cuts its day and hour off. */}
            {change.when !== null && taskEdit !== null && editable ? (
              <button
                type="button"
                className="task-when"
                data-open={dateOpen}
                data-changed={Boolean(taskEdit.due)}
                title="Change the day and hour"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDate(event.currentTarget);
                }}
              >
                <Calendar size={9} />
                <span>{taskEdit.due ? dueLabel({ due: taskEdit.due, time: taskEdit.time }) : `${change.when}${change.whenSuggested ? " · suggested" : ""}`}</span>
              </button>
            ) : (
              change.when !== null && <span className="when-text">{taskEdit?.due ? dueLabel({ due: taskEdit.due, time: taskEdit.time }) : change.when}{!taskEdit?.due && change.whenSuggested ? " · suggested" : ""}</span>
            )}
          </span>
        )}
        <span className="value-chevron" style={{ opacity: hasOptions ? 1 : 0 }}><ChevronDown size={8} stroke={3.6} /></span>
      </div>
    </div>
  );
}

/** A free-text value typed in place: Enter or a click elsewhere keeps it, Escape leaves it as it was. Grows with the text. */
function ValueEditor({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(text);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="value-input"
      rows={1}
      value={draft}
      // A CRM value is written as typed: no spelling marks, no corrections, no word suggestions from the system.
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      autoComplete="off"
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          finish(draft);
        } else if (event.key === "Escape") {
          finish(null);
        }
      }}
      onBlur={() => {
        finish(draft);
        releaseKeyboardSoon();
      }}
    />
  );
}

/** Tasks the rep adds by hand: a title, a day and an hour. Listed under the changes and written to the CRM with Save; each can still be re-worded and moved. */
function AddTask({ tasks, onChange, onPopupExtent }: { tasks: NewTask[]; onChange: (tasks: NewTask[]) => void; onPopupExtent: (bottom: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<TaskDue>(() => ({ due: dayAfter(1), time: null }));
  // The picker is for the form's own day ("new") or for one of the listed tasks (its index).
  const [picker, setPicker] = useState<{ target: "new" | number; anchor: Anchor } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    setTitle("");
    setWhen({ due: dayAfter(1), time: null });
    releaseKeyboardSoon();
  };
  const add = () => {
    const text = title.replace(/\s+/g, " ").trim();
    if (!text) return;
    onChange([...tasks, { title: text, due: when.due, time: when.time }]);
    close();
  };
  const update = (index: number, patch: Partial<NewTask>) => onChange(tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)));
  const openPicker = (target: "new" | number, element: Element) => setPicker((current) => (current?.target === target ? null : { target, anchor: anchorOf(element) }));
  useEffect(() => {
    if (!open) return;
    void window.vocifyIsland?.keyboard?.("now");
    input.current?.focus();
  }, [open]);
  const pickerValue: TaskDue | null = picker ? (picker.target === "new" ? when : tasks[picker.target] ? { due: tasks[picker.target].due, time: tasks[picker.target].time } : null) : null;
  return (
    <div className="task-add">
      {tasks.map((task, index) => (
        <div key={index} className="task-row">
          <span className="meeting-icon"><Check size={10} stroke={3} /></span>
          {editing === index ? (
            <div className="task-title" onMouseEnter={keyboardOver} onMouseDown={keyboardNow}>
              <ValueEditor text={task.title} onDone={(text) => {
                setEditing(null);
                if (text !== null && text.trim() !== "") update(index, { title: text.replace(/\s+/g, " ").trim().slice(0, 200) });
              }} />
            </div>
          ) : (
            <button type="button" className="task-title task-title-button" title="Edit the text" onMouseEnter={keyboardOver} onMouseDown={keyboardNow} onClick={() => setEditing(index)}>{task.title}</button>
          )}
          <button type="button" className="task-when" data-open={picker?.target === index} title="Change the day and hour" onClick={(event) => { event.stopPropagation(); openPicker(index, event.currentTarget); }}>
            <Calendar size={9} />
            <span>{dueLabel(task)}</span>
          </button>
          <button type="button" className="icon-button" title="Remove this task" aria-label="Remove this task" onClick={() => { setPicker(null); onChange(tasks.filter((_, i) => i !== index)); }}>
            <Close size={9} />
          </button>
        </div>
      ))}
      {open ? (
        <div className="task-form">
          <input
            ref={input}
            className="task-input"
            value={title}
            placeholder="Task, e.g. Send the proposal"
            spellCheck={false}
            autoComplete="off"
            maxLength={200}
            onMouseEnter={keyboardOver}
            onMouseDown={keyboardNow}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              } else if (event.key === "Escape") {
                close();
              }
            }}
          />
          <div className="task-days">
            <button type="button" className="task-when" data-open={picker?.target === "new"} title="Pick the day and hour" onClick={(event) => { event.stopPropagation(); openPicker("new", event.currentTarget); }}>
              <Calendar size={9} />
              <span>{dueLabel(when)}</span>
            </button>
            <div className="grow" />
            <button type="button" className="small-action" disabled={title.trim() === ""} onClick={add}>Add</button>
            <TextAction title="Cancel" onClick={close} />
          </div>
        </div>
      ) : (
        <button type="button" className="text-action task-open" onClick={() => setOpen(true)}>
          <Plus size={9} />
          <span>Add task</span>
        </button>
      )}
      {picker && pickerValue && (
        <TaskDatePicker
          anchor={picker.anchor}
          value={pickerValue}
          onClose={() => setPicker(null)}
          onExtent={onPopupExtent}
          onChange={(next) => (picker.target === "new" ? setWhen(next) : update(picker.target, { due: next.due, time: next.time }))}
        />
      )}
    </div>
  );
}

/** The agreed meeting: a quiet line under the changes, added with one click. */
function MeetingRow({ meeting, onAdd, onReview }: { meeting: PostCallMeeting; onAdd: () => void; onReview: () => void }) {
  const text =
    meeting.state === "pending" ? (meeting.when ? `Meeting ${meeting.when}` : "Meeting agreed") : meeting.state === "check" ? "Meeting to confirm" : meeting.when ? `Meeting ${meeting.when} added` : "Meeting added";
  return (
    <div className="meeting-row" style={{ height: L.meeting }}>
      <span className="meeting-icon">{meeting.state === "added" ? <Check size={10} stroke={3} /> : <Calendar />}</span>
      <span className="meeting-text">{text}</span>
      <div className="grow" />
      {meeting.state === "pending" && <TextAction title="Add" onClick={onAdd} />}
      {meeting.state === "check" && <TextAction title="Review" onClick={onReview} />}
    </div>
  );
}

/** The note: edited here while the card can still save it (it rides on Save), read-only after. Grows to 8 lines, then scrolls. */
function NoteBox({ editable, text, placeholder, onChange }: { editable: boolean; text: string; placeholder: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
    el.style.height = "0px";
    const lines = Math.max(editable ? L.noteMinLines : 1, Math.min(L.noteLines, Math.round(el.scrollHeight / lineHeight)));
    el.style.height = `${lines * lineHeight}px`;
  }, [text, editable]);
  return (
    <div className="note-box" style={{ marginTop: L.gap }}>
      <textarea
        ref={ref}
        className="note-text"
        value={text}
        readOnly={!editable}
        placeholder={placeholder}
        spellCheck={editable}
        onMouseEnter={editable ? keyboardOver : undefined}
        onMouseDown={editable ? keyboardNow : undefined}
        onMouseLeave={releaseKeyboardSoon}
        onBlur={releaseKeyboardSoon}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** How long Undo stays: a thin line that shrinks over the 5 s. */
function UndoLine({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= until) return;
    const timer = setTimeout(() => setNow(Date.now()), 33);
    return () => clearTimeout(timer);
  }, [now, until]);
  return <div className="undo-line" style={{ width: `${Math.max(0, Math.min(1, (until - now) / 5000)) * 100}%` }} />;
}
