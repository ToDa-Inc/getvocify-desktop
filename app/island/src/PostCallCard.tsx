import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Close } from "./icons.tsx";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { postCallCrmName, type IslandAction, type PostCallChange, type PostCallData } from "./types.ts";

type Act = (action: IslandAction) => void;

const L = { header: 34, tabs: 24, gap: 8, top: 12, inset: 12, rowInset: 6, rowPadding: 8, groupLabel: 18, line: 32, listMax: 236, actions: 40, meeting: 26, bottom: 10, tick: 14, label: 104, chevron: 14, option: 26, optionsVisible: 7, optionsPadding: 4, valueSize: 12, emailLines: 3, noteLines: 5 } as const;
const lineHeight = (sz: number) => Math.ceil(sz * 1.35);

const GROUPS: Array<{ object: string; title: string }> = [
  { object: "contact", title: "Contact" }, { object: "company", title: "Company" }, { object: "deal", title: "Deal" }, { object: "other", title: "Other" },
];

function rowHeight(change: PostCallChange, shown: string): number {
  const valueWidth = 420 - L.inset * 2 - L.rowInset * 2 - L.tick - L.label - L.chevron - 16;
  const text = change.from ? `${shown}  was ${change.from}` : shown;
  const lines = Math.min(2, Math.max(1, Math.ceil(text.length * L.valueSize / valueWidth / 3)));
  return lines * lineHeight(L.valueSize) + L.rowPadding;
}

function groupedChanges(pc: PostCallData, e: Record<string, string>) {
  const sure = pc.changes.filter(c => !c.check);
  return GROUPS.map(g => {
    const ch = sure.filter(c => c.object === g.object || (g.object === "other" && !["contact", "company", "deal"].includes(c.object)));
    return ch.length ? { title: g.title, changes: ch } : null;
  }).filter((x): x is { title: string; changes: PostCallChange[] } => x !== null);
}

function shown(change: PostCallChange, e: Record<string, string>): string {
  const ed = e[change.key];
  if (!ed || !change.options.length) return change.to;
  const vals = change.multiple ? ed.split(";").map(v => v.trim()).filter(Boolean) : [ed];
  const lbls = vals.map(v => change.options.find(o => o.value === v)?.label ?? v);
  return lbls.length ? lbls.join(", ") : "—";
}

export function PostCallCard({ postCall, act, onPopupExtent }: { postCall: PostCallData; act: Act; /** Where an open dropdown ends (px from the window's top), or null: the window grows to include it. */ onPopupExtent: (bottom: number | null) => void }) {
  const [keptChanges, setKeptChanges] = useState<Set<string>>(() => new Set(postCall.changes.filter(c => !c.check).map(c => c.key)));
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"crm" | "email" | "notes">("crm");
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [optionsAnchor, setOptionsAnchor] = useState<Anchor | null>(null);
  const [typeListOpen, setTypeListOpen] = useState(false);
  const [typeAnchor, setTypeAnchor] = useState<Anchor | null>(null);

  useEffect(() => {
    setKeptChanges(new Set(postCall.changes.filter(c => !c.check).map(c => c.key)));
    setEditedValues({});
    setOpenOptions(null);
    setNoteDraft(null);
    setActiveTab("crm");
    setTypeListOpen(false);
  }, [postCall.memoId]);

  const tabs: Array<"crm" | "email" | "notes"> = ["crm"];
  if (postCall.email) tabs.push("email");
  if (postCall.notes || postCall.summary) tabs.push("notes");
  const tab = tabs.includes(activeTab) ? activeTab : "crm";

  const groups = groupedChanges(postCall, editedValues);
  const nothingSure = groups.length === 0;

  const toggleChange = (key: string) => setKeptChanges(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const pick = (val: string, change: PostCallChange) => {
    let next = val;
    if (change.multiple) {
      const vals = (editedValues[change.key] || "").split(";").map(v => v.trim()).filter(Boolean);
      const idx = vals.indexOf(val);
      idx >= 0 ? vals.splice(idx, 1) : vals.push(val);
      next = vals.join(";");
    }
    const ne = { ...editedValues };
    next === change.value ? delete ne[change.key] : ne[change.key] = next;
    setEditedValues(ne);
    setKeptChanges(p => new Set([...p, change.key]));
    if (!change.multiple) setOpenOptions(null);
  };

  const toggleOpts = (change: PostCallChange, element: Element) => {
    setTypeListOpen(false);
    if (openOptions === change.key) {
      setOpenOptions(null);
    } else {
      setOpenOptions(change.key);
      setOptionsAnchor(anchorOf(element));
    }
  };

  const closeMenus = useCallback(() => {
    setOpenOptions(null);
    setTypeListOpen(false);
  }, []);

  const handleApprove = () => {
    const kept = postCall.changes.filter(c => keptChanges.has(c.key));
    const edits: Record<string, string> = {};
    kept.forEach(c => edits[c.key] = editedValues[c.key] ?? c.value);
    act({ name: "postCall", type: "approve", details: { omit: [], edits, note: noteDraft && noteDraft !== postCall.note ? noteDraft : undefined } });
  };

  return (
    <>
      <div className="postcall-card">
        <div className="postcall-header">
          <div className="postcall-title">{postCall.contactName ?? "Your call"}</div>
          {postCall.type && (
            <button type="button" className="type-tag" onClick={e => { e.stopPropagation(); setOpenOptions(null); setTypeAnchor(anchorOf(e.currentTarget)); setTypeListOpen(!typeListOpen); }}>
              {postCall.type.label}
              {postCall.type.options.length > 0 && <ChevronDown size={7} style={{ transform: typeListOpen ? "rotate(180deg)" : "rotate(0deg)" }} />}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="icon-button" onClick={() => act({ name: "postCall", type: "dismiss" })}><Close size={11} /></button>
        </div>

        {tabs.length > 1 && (
          <div className="postcall-tabs">
            {tabs.map(t => {
              const cnt = t === "crm" && postCall.stage === "ready" ? keptChanges.size : t === "email" && postCall.email?.state === "ready" ? 1 : 0;
              return (
                <button key={t} type="button" className="postcall-tab" data-active={t === tab} onClick={() => { setActiveTab(t); setOpenOptions(null); setTypeListOpen(false); }}>
                  {t === "crm" ? "CRM" : t === "email" ? "Email" : "Notes"}
                  {cnt > 0 && <span className="tab-badge">{cnt}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="postcall-body">
          {tab === "crm" && (() => {
            if (postCall.stage === "writing") return <div className="postcall-line"><span className="spinner" /><span>Writing the update…</span></div>;
            if (postCall.stage === "applying") return <div><div className="postcall-line"><span className="spinner" /><span>Updating {postCall.contactName ?? "the contact"} in {postCallCrmName(postCall)}…</span><div style={{ flex: 1 }} /><button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "undo" })}>Undo</button></div>{postCall.undoUntil && <div className="undo-line" style={{ width: `${Math.max(0, Math.min(1, (postCall.undoUntil - Date.now()) / 5000)) * 100}%` }} />}</div>;
            if (postCall.stage === "done") return <div className="postcall-line"><Check size={11} /><span>{postCall.applied === 1 ? "1 field updated" : `${postCall.applied} fields updated`} in {postCallCrmName(postCall)}</span></div>;
            if (postCall.stage === "review") return <div className="postcall-line"><span>Please review in Vocify</span><div style={{ flex: 1 }} /><button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "review" })}>Review</button></div>;
            if (postCall.stage === "internal") return <div className="postcall-line"><span>Internal call</span></div>;
            if (nothingSure) return <div className="postcall-line"><span>Nothing clear enough to write from here</span><div style={{ flex: 1 }} /><button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "review" })}>Review in Vocify</button></div>;
            return (
              <>
                <div className="changes-list">
                  {groups.map(g => (
                    <div key={g.title}>
                      <div className="group-label">{g.title.toUpperCase()}</div>
                      {g.changes.map(c => <ChangeRow key={c.key} change={c} shown={shown(c, editedValues)} kept={keptChanges.has(c.key)} height={rowHeight(c, shown(c, editedValues))} open={openOptions === c.key} toggle={() => toggleChange(c.key)} toggleOptions={r => toggleOpts(c, r)} />)}
                    </div>
                  ))}
                </div>
                {postCall.meeting && <MeetingRow meeting={postCall.meeting} onAdd={() => act({ name: "postCall", type: "addMeeting" })} onReview={() => act({ name: "postCall", type: "review" })} />}
                <div className="postcall-actions">
                  {postCall.canApprove && <button type="button" className="primary-action" disabled={keptChanges.size === 0} onClick={handleApprove}><Check size={9} /><span>Save {keptChanges.size} to {postCall.crm ?? "the CRM"}</span></button>}
                  <div style={{ flex: 1 }} />
                  <button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "review" })}>Review in Vocify</button>
                </div>
              </>
            );
          })()}

          {tab === "email" && postCall.email && (
            postCall.email.state === "ready" ? (
              postCall.email.subject || postCall.email.preview ? (
                <>
                  <div className="email-box">
                    {postCall.email.to && <div className="email-to">To {postCall.email.to}</div>}
                    <div className="email-subject">{postCall.email.subject ?? "Follow-up"}</div>
                    {postCall.email.preview && <div className="email-preview">{postCall.email.preview}</div>}
                  </div>
                  <div className="postcall-actions">
                    <button type="button" className="primary-action" onClick={() => act({ name: "postCall", type: "openEmail" })}><span>Open draft</span></button>
                    <button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "skipEmail" })}>Skip</button>
                    {postCall.offerStopEmails && <button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "stopEmails" })}>Stop emails</button>}
                  </div>
                </>
              ) : (
                <div className="postcall-line"><span>{postCall.email.to ? `Email to ${postCall.email.to} ready` : "Email ready"}</span><div style={{ flex: 1 }} /><button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "openEmail" })}>Open</button><button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "skipEmail" })}>Skip</button>{postCall.offerStopEmails && <button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "stopEmails" })}>Stop</button>}</div>
              )
            ) : postCall.email.state === "skipped" ? (
              <div className="postcall-line"><span>Email skipped</span><div style={{ flex: 1 }} /><button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "unskipEmail" })}>Undo</button>{postCall.offerStopEmails && <button type="button" className="small-action" onClick={() => act({ name: "postCall", type: "keepEmails" })}>Keep emails</button>}</div>
            ) : postCall.email.state === "sent" ? (
              <div className="postcall-line"><Check size={11} /><span>Email sent</span></div>
            ) : null
          )}

          {tab === "notes" && (
            <>
              {postCall.summary && <div className="notes-summary">{postCall.summary}</div>}
              {postCall.notes && <textarea className="note-draft" value={noteDraft ?? ""} onChange={e => setNoteDraft(e.target.value)} placeholder="Add note..." />}
              <div className="postcall-actions">
                <button type="button" className="text-action" onClick={() => act({ name: "postCall", type: "openNotes" })}>Open in Vocify</button>
              </div>
            </>
          )}
        </div>
      </div>

      {openOptions && optionsAnchor && (() => {
        const change = postCall.changes.find((c) => c.key === openOptions);
        if (!change) return null;
        const selected = pickedValues(change, editedValues[change.key]);
        return (
          <FloatMenu anchor={optionsAnchor} width={Math.max(160, Math.round(optionsAnchor.width) + 8)} onClose={closeMenus} onExtent={onPopupExtent} label={change.label}>
            {change.options.map((opt) => (
              <MenuRow key={opt.value} label={opt.label} selected={selected.includes(opt.value)} onPick={() => pick(opt.value, change)} />
            ))}
          </FloatMenu>
        );
      })()}
      {typeListOpen && typeAnchor && postCall.type && postCall.type.options.length > 0 && (
        <FloatMenu anchor={typeAnchor} width={190} onClose={closeMenus} onExtent={onPopupExtent} label="Call type">
          {[{ key: postCall.type.key, label: postCall.type.label }, ...postCall.type.options.filter((o) => o.key !== postCall.type?.key)].map((opt) => (
            <MenuRow key={opt.key} label={opt.label} selected={postCall.type?.key === opt.key} onPick={() => { act({ name: "postCall", type: "setType", details: { key: opt.key } }); setTypeListOpen(false); }} />
          ))}
        </FloatMenu>
      )}
    </>
  );
}

function ChangeRow({ change, shown: s, kept, height, open, toggle, toggleOptions }: { change: PostCallChange; shown: string; kept: boolean; height: number; open: boolean; toggle: () => void; toggleOptions: (element: Element) => void }) {
  const [hoverVal, setHoverVal] = useState(false);
  const valRef = useRef<HTMLDivElement>(null);
  const lh = lineHeight(L.valueSize);
  const tickTop = (lh - L.tick) / 2;

  return (
    <div className="change-row" style={{ height }}>
      <button type="button" className="change-toggle" onClick={toggle}>
        <div className="tick" data-kept={kept} style={{ marginTop: `${tickTop}px` }}>
          {kept && <Check size={7.5} />}
        </div>
        <span className="change-label">{change.label}</span>
      </button>
      <div className="change-value" ref={valRef} onMouseEnter={() => setHoverVal(true)} onMouseLeave={() => setHoverVal(false)} onClick={(e) => { if (change.options.length) { e.stopPropagation(); toggleOptions(valRef.current!); } else toggle(); }}>
        <span data-kept={kept}>{s}</span>
        {change.from && <span className="was-text">was {change.from}</span>}
        {change.options.length > 0 && <ChevronDown size={8} style={{ opacity: open || hoverVal ? 1 : 0.5, marginTop: `${tickTop}px` }} />}
      </div>
    </div>
  );
}

function MeetingRow({ meeting, onAdd, onReview }: { meeting: { state: string; when: string | null }; onAdd: () => void; onReview: () => void }) {
  const text = meeting.state === "pending" ? (meeting.when ? `Meeting ${meeting.when}` : "Meeting agreed") : meeting.state === "check" ? "Meeting to confirm" : meeting.when ? `Meeting ${meeting.when} added` : "Meeting added";
  return (
    <div className="meeting-row">
      <span>{text}</span>
      <div style={{ flex: 1 }} />
      {meeting.state === "pending" && <button type="button" className="text-action" onClick={onAdd}>Add</button>}
      {meeting.state === "check" && <button type="button" className="text-action" onClick={onReview}>Review</button>}
    </div>
  );
}


/** The values picked now: what the rep chose, else what was extracted (`;`-joined for a checkbox list). */
function pickedValues(change: PostCallChange, edited: string | undefined): string[] {
  const raw = edited ?? change.value;
  return change.multiple ? raw.split(";").map((v) => v.trim()).filter(Boolean) : [raw];
}

