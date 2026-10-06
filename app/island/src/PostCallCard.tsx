import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { ArrowUpRight, Calendar, Check, ChevronDown, Close, ExclamationCircle, FileText, IdCard, Mail, Users } from "./icons.tsx";
import { postCallCrmName, type IslandAction, type PostCallChange, type PostCallData, type PostCallMeeting } from "./types.ts";

/**
 * The after-call card: a port of `PostCallMenu` (MeetingPill.swift) with its layout numbers (`PostCallLayout`).
 * CRM / Email / Notes tabs; the changes grouped by record with a tick each; a value with options opens a floating list,
 * free text is edited in Vocify (the dashboard only takes values from a field's options); the note is edited here and
 * saved with the update.
 */

type Act = (action: IslandAction) => void;
type Tab = "crm" | "email" | "notes";

const L = { inset: 16, top: 6, header: 26, tabs: 26, gap: 8, line: 30, groupLabel: 20, listMax: 236, actions: 40, meeting: 26, bottom: 10, label: 104, noteLines: 8, noteMinLines: 3 } as const;
const GROUPS = [
  { object: "contact", title: "Contact" },
  { object: "company", title: "Company" },
  { object: "deal", title: "Deal" },
  { object: "other", title: "Other" },
];

/** The changes the card lists, by record. One the call wasn't clear on is left to the review in Vocify. */
function groupedChanges(postCall: PostCallData) {
  const sure = postCall.changes.filter((c) => !c.check);
  return GROUPS.flatMap((group) => {
    const changes = sure.filter((c) => c.object === group.object || (group.object === "other" && !["contact", "company", "deal"].includes(c.object)));
    return changes.length ? [{ title: group.title, changes }] : [];
  });
}

function pickedValues(change: PostCallChange, edited: string | undefined): string[] {
  const raw = edited ?? change.value;
  return change.multiple ? raw.split(";").map((v) => v.trim()).filter(Boolean) : [raw];
}

/** What the value reads as: the picked options' labels, or the text (as typed, when the rep edited it). */
function shownValue(change: PostCallChange, edited: string | undefined): string {
  if (edited === undefined) return change.to;
  if (change.options.length === 0) return edited;
  const labels = pickedValues(change, edited).map((v) => change.options.find((o) => o.value === v)?.label ?? v);
  return labels.length ? labels.join(", ") : "—";
}

export function PostCallCard({ postCall, act, onPopupExtent }: { postCall: PostCallData; act: Act; /** Where an open dropdown ends (px from the window's top), or null: the window grows to include it. */ onPopupExtent: (bottom: number | null) => void }) {
  const [kept, setKept] = useState<Set<string>>(() => new Set(postCall.changes.filter((c) => !c.check).map((c) => c.key)));
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("crm");
  const [options, setOptions] = useState<{ key: string; anchor: Anchor } | null>(null);
  const [typeMenu, setTypeMenu] = useState<Anchor | null>(null);

  // A new call: its own ticks, picks and note.
  useEffect(() => {
    setKept(new Set(postCall.changes.filter((c) => !c.check).map((c) => c.key)));
    setEdited({});
    setNoteDraft(null);
    setActiveTab("crm");
    setOptions(null);
    setTypeMenu(null);
  }, [postCall.memoId]);

  // Past its changes (applying, done...), a value's options no longer apply.
  useEffect(() => {
    if (postCall.stage !== "ready") setOptions(null);
  }, [postCall.stage]);

  const groups = groupedChanges(postCall);
  const nothingSure = groups.length === 0;
  const noteEditable = postCall.stage === "ready" && postCall.canApprove && !nothingSure;
  const noteText = noteDraft ?? postCall.summary ?? "";
  const tabs: Tab[] = ["crm"];
  if (postCall.email) tabs.push("email");
  if (postCall.notes || postCall.summary !== null || noteEditable) tabs.push("notes");
  const tab = tabs.includes(activeTab) ? activeTab : "crm";
  const keptCount = postCall.changes.filter((c) => kept.has(c.key)).length;
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
  }, []);

  const toggleChange = (key: string) =>
    setKept((previous) => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
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
    setKept((previous) => new Set([...previous, change.key]));
    if (!change.multiple) setOptions(null);
  };

  /** Like the Mac app: what is not ticked is left out, and only values the rep changed are sent as edits. */
  const approve = () => {
    const omit = postCall.changes.map((c) => c.key).filter((key) => !kept.has(key));
    if (omit.length >= postCall.changes.length) return;
    const edits = Object.fromEntries(Object.entries(edited).filter(([key, value]) => postCall.changes.some((c) => c.key === key && c.value !== value)));
    act({ name: "postCall", type: "approve", details: { omit, edits, ...(noteDraft !== null ? { note: noteDraft } : {}) } });
  };

  const send = (type: string, details?: Record<string, unknown>) => act({ name: "postCall", type, details });
  const review = <TextAction title="Review in Vocify" arrow onClick={() => send("review")} />;

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
            {postCall.stage === "writing" && <Line busy><span className="dim">Writing the update…</span></Line>}
            {postCall.stage === "ready" && nothingSure && (
              <Line icon={<ExclamationCircle />} trailing={review}>
                <span>Nothing clear enough to write from here</span>
              </Line>
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
                          shown={shownValue(change, edited[change.key])}
                          kept={kept.has(change.key)}
                          open={options?.key === change.key}
                          toggle={() => toggleChange(change.key)}
                          editable={typable && change.editable}
                          onEdit={(text) => {
                            setEdited((previous) => ({ ...previous, [change.key]: text }));
                            setKept((previous) => new Set([...previous, change.key]));
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
                <div className="postcall-actions" style={{ height: L.actions }}>
                  {postCall.canApprove ? (
                    <>
                      <button type="button" className="primary-action" disabled={keptCount === 0} title={`Writes the ticked changes to ${crm}`} onClick={approve}>
                        <Check size={9} />
                        <span>{keptCount === 0 ? "Nothing ticked" : `Save ${keptCount} to ${postCall.crm ?? "the CRM"}`}</span>
                      </button>
                      <div className="grow" />
                      {review}
                    </>
                  ) : (
                    <>
                      {review}
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
              <Line icon={<Check size={10.5} stroke={3} />}>
                <span>{postCall.applied === null ? `Updated in ${crm}` : postCall.applied === 1 ? `1 field updated in ${crm}` : `${postCall.applied} fields updated in ${crm}`}</span>
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
              <TextAction title="Open in Vocify" arrow onClick={() => send("openNotes")} />
              <div className="grow" />
              {noteEditable && <span className="note-hint">Saved to {crm} with the update</span>}
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
    </>
  );
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
function ChangeRow({ change, shown, kept, open, toggle, toggleOptions, editable, onEdit }: { change: PostCallChange; shown: string; kept: boolean; open: boolean; toggle: () => void; toggleOptions: (element: Element) => void; editable: boolean; onEdit: (text: string) => void }) {
  const value = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const before = change.from !== null && change.from !== shown ? change.from : null;
  const hasOptions = change.options.length > 0;
  return (
    <div className="change-row">
      <button type="button" className="change-toggle" title={kept ? "Untick to leave it out" : "Tick to write it"} aria-label={change.label} aria-pressed={kept} onClick={toggle}>
        <span className="tick" data-kept={kept} data-check={change.check}>{kept && <Check size={7.5} stroke={4} />}</span>
        <span className="change-label" style={{ width: L.label }}>{change.label}</span>
      </button>
      <div
        ref={value}
        className="change-value"
        data-open={open}
        title={hasOptions ? (change.multiple ? "Pick one or more" : "Pick another value") : editable ? "Edit the text" : "Edit it in Vocify"}
        onMouseEnter={editable && !hasOptions ? keyboardOver : undefined}
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
          <span className="value-text">
            <span data-kept={kept}>{shown}</span>
            {before !== null && <span className="was-text">{"  was "}{before}</span>}
          </span>
        )}
        <span className="value-chevron" style={{ opacity: hasOptions ? 1 : 0 }}><ChevronDown size={8} stroke={3.6} /></span>
      </div>
    </div>
  );
}

/** The pointer is over a field the rep can type in: the click that follows focuses the island (see `keyboard`). */
function keyboardOver(): void {
  void window.vocifyIsland?.keyboard?.("over");
}

/** Gives the keyboard back once no field of the card has the caret any more (a moment later: focus may be moving). */
function releaseKeyboardSoon(): void {
  setTimeout(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) void window.vocifyIsland?.keyboard?.("release");
  }, 150);
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
