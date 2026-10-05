import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Close } from "./icons.tsx";
import { postCallCrmName, type IslandAction, type PostCallChange, type PostCallData, type PostCallEmail, type PostCallMeeting, type PostCallOption } from "./types.ts";

type Act = (action: IslandAction) => void;

const L = {
  header: 34,
  tabs: 24,
  gap: 8,
  top: 12,
  inset: 12,
  rowInset: 6,
  rowPadding: 8,
  groupLabel: 18,
  line: 32,
  listMax: 236,
  actions: 40,
  meeting: 26,
  bottom: 10,
  tick: 14,
  label: 104,
  chevron: 14,
  option: 26,
  optionsVisible: 7,
  optionsPadding: 4,
  valueSize: 12,
  emailLines: 3,
  noteLines: 5,
} as const;

const GROUPS: Array<{ object: string; title: string }> = [
  { object: "contact", title: "Contact" },
  { object: "company", title: "Company" },
  { object: "deal", title: "Deal" },
  { object: "other", title: "Other" },
];

function lineHeight(size: number): number {
  // Approximate line height: ~1.32 * font size + leading
  return Math.ceil(size * 1.4);
}

function textLines(text: string, width: number, limit: number): number {
  // Simple approximation: ~3-4 chars per 10px at 12px size
  if (!text) return 1;
  const charsPerLine = Math.max(1, Math.floor(width / 3));
  const lines = Math.ceil(text.length / charsPerLine);
  return Math.min(limit, Math.max(1, lines));
}

function rowHeight(change: PostCallChange, shown: string): number {
  const valueWidth = L.inset * 2 - L.rowInset * 2 - L.tick - L.label - L.chevron - 16;
  const valueText = change.from ? `${shown}  was ${change.from}` : shown;
  const count = textLines(valueText, valueWidth, 2);
  return count * lineHeight(L.valueSize) + L.rowPadding;
}

function groupedChanges(postCall: PostCallData, editedValues: Record<string, string>): Array<{ title: string; changes: PostCallChange[] }> {
  const sure = postCall.changes.filter((c) => !c.check);
  return GROUPS.map((group) => {
    const changes = sure.filter((c) => c.object === group.object || (group.object === "other" && !["contact", "company", "deal"].includes(c.object)));
    return changes.length === 0 ? null : { title: group.title, changes };
  }).filter((g): g is { title: string; changes: PostCallChange[] } => g !== null);
}

function shown(change: PostCallChange, editedValues: Record<string, string>): string {
  const edited = editedValues[change.key];
  if (!edited || change.options.length === 0) return change.to;
  const values = change.multiple ? edited.split(";").map((v) => v.trim()).filter(Boolean) : [edited];
  const labels = values.map((v) => change.options.find((o) => o.value === v)?.label ?? v);
  return labels.length === 0 ? "—" : labels.join(", ");
}

export function PostCallCard({ postCall, act }: { postCall: PostCallData; act: Act }) {
  const [keptChanges, setKeptChanges] = useState<Set<string>>(() => new Set(postCall.changes.filter((c) => !c.check).map((c) => c.key)));
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"crm" | "email" | "notes">("crm");
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  const [optionsAnchor, setOptionsAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Reset when memo changes
  useEffect(() => {
    setKeptChanges(new Set(postCall.changes.filter((c) => !c.check).map((c) => c.key)));
    setEditedValues({});
    setOpenOptions(null);
    setActiveTab("crm");
  }, [postCall.memoId]);

  const getTabs = useCallback(() => {
    const tabs: Array<"crm" | "email" | "notes"> = ["crm"];
    if (postCall.email) tabs.push("email");
    if (postCall.notes || postCall.summary) tabs.push("notes");
    return tabs;
  }, [postCall.email, postCall.notes, postCall.summary]);

  const tabs = getTabs();
  const tab = tabs.includes(activeTab) ? activeTab : "crm";

  const groups = groupedChanges(postCall, editedValues);
  const changesHeight = groups.reduce((h, g) => h + L.groupLabel + g.changes.reduce((ch, c) => ch + rowHeight(c, shown(c, editedValues)), 0), 0);
  const listHeight = Math.min(changesHeight, L.listMax);

  const kept = postCall.changes.filter((c) => keptChanges.has(c.key)).length;
  const nothingSure = groups.length === 0;

  const toggleChange = useCallback((key: string) => {
    setKeptChanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const pick = useCallback(
    (value: string, change: PostCallChange) => {
      let next = value;
      if (change.multiple) {
        const values = editedValues[change.key] ? editedValues[change.key].split(";").map((v) => v.trim()) : [];
        const idx = values.indexOf(value);
        if (idx >= 0) {
          values.splice(idx, 1);
        } else {
          values.push(value);
        }
        next = values.join(";");
      }
      const newEdited = { ...editedValues };
      if (next === change.value) {
        delete newEdited[change.key];
      } else {
        newEdited[change.key] = next;
      }
      setEditedValues(newEdited);
      setKeptChanges((prev) => new Set([...prev, change.key]));
      if (!change.multiple) setOpenOptions(null);
    },
    [editedValues]
  );

  const toggleOptions = useCallback((change: PostCallChange, rect: DOMRect) => {
    if (openOptions === change.key) {
      setOpenOptions(null);
    } else {
      setOpenOptions(change.key);
      setOptionsAnchor({ x: rect.left, y: rect.top, height: rect.height });
    }
  }, [openOptions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpenOptions(null);
      }
    };
    if (openOptions) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openOptions]);

  const handleApprove = () => {
    const changes = postCall.changes.filter((c) => keptChanges.has(c.key));
    const edits: Record<string, string> = {};
    for (const change of changes) {
      const val = editedValues[change.key] ?? change.value;
      edits[change.key] = val;
    }
    act({ name: "postCall", type: "approve", details: { omit: [], edits } });
  };

  const handleUndo = () => {
    act({ name: "postCall", type: "undo" });
  };

  const handleReview = () => {
    act({ name: "postCall", type: "review" });
  };

  const handleDismiss = () => {
    act({ name: "postCall", type: "dismiss" });
  };

  const handleOpenEmail = () => {
    act({ name: "postCall", type: "openEmail" });
  };

  const handleSkipEmail = () => {
    act({ name: "postCall", type: "skipEmail" });
  };

  const handleUnskipEmail = () => {
    act({ name: "postCall", type: "unskipEmail" });
  };

  const handleAddMeeting = () => {
    act({ name: "postCall", type: "addMeeting" });
  };

  const handleOpenNotes = () => {
    act({ name: "postCall", type: "openNotes" });
  };

  const handleSetType = (key: string) => {
    act({ name: "postCall", type: "setType", details: { key } });
  };

  return (
    <div className="postcall-card" ref={cardRef}>
      <div className="postcall-header">
        <div className="postcall-title">{postCall.contactName ?? "Your call"}</div>
        {postCall.type && (
          <button
            type="button"
            className="type-menu-button"
            onClick={(e) => {
              e.stopPropagation();
              // Open type menu
            }}
            title={postCall.type.label}
          >
            {postCall.type.label}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="icon-button" onClick={handleDismiss} title="Done">
          <Close size={11} />
        </button>
      </div>

      {tabs.length > 1 && (
        <div className="postcall-tabs">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              className="postcall-tab"
              data-active={t === tab}
              onClick={() => setActiveTab(t)}
            >
              <span className="tab-label">{t === "crm" ? "CRM" : t === "email" ? "Email" : "Notes"}</span>
              {t === "crm" && postCall.stage === "ready" && kept > 0 && <span className="tab-badge">{kept}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="postcall-body">
        {tab === "crm" && <CrmTab postCall={postCall} groups={groups} keptChanges={keptChanges} editedValues={editedValues} listHeight={listHeight} rowHeight={rowHeight} shown={shown} toggleChange={toggleChange} pick={pick} toggleOptions={toggleOptions} nothingSure={nothingSure} kept={kept} handleApprove={handleApprove} handleUndo={handleUndo} handleReview={handleReview} />}
        {tab === "email" && <EmailTab email={postCall.email} handleOpenEmail={handleOpenEmail} handleSkipEmail={handleSkipEmail} handleUnskipEmail={handleUnskipEmail} />}
        {tab === "notes" && <NotesTab postCall={postCall} handleOpenNotes={handleOpenNotes} />}
      </div>

      {openOptions && optionsAnchor && (
        <OptionsPopup
          ref={popupRef}
          anchor={optionsAnchor}
          change={postCall.changes.find((c) => c.key === openOptions)!}
          editedValues={editedValues}
          onPick={pick}
        />
      )}
    </div>
  );
}

function CrmTab({
  postCall,
  groups,
  keptChanges,
  editedValues,
  listHeight,
  rowHeight: getRowHeight,
  shown: getShown,
  toggleChange,
  pick,
  toggleOptions,
  nothingSure,
  kept,
  handleApprove,
  handleUndo,
  handleReview,
}: {
  postCall: PostCallData;
  groups: Array<{ title: string; changes: PostCallChange[] }>;
  keptChanges: Set<string>;
  editedValues: Record<string, string>;
  listHeight: number;
  rowHeight: (c: PostCallChange, s: string) => number;
  shown: (c: PostCallChange, e: Record<string, string>) => string;
  toggleChange: (k: string) => void;
  pick: (v: string, c: PostCallChange) => void;
  toggleOptions: (c: PostCallChange, r: DOMRect) => void;
  nothingSure: boolean;
  kept: number;
  handleApprove: () => void;
  handleUndo: () => void;
  handleReview: () => void;
}) {
  switch (postCall.stage) {
    case "writing":
      return (
        <div className="postcall-line">
          <span className="spinner" style={{ width: 12, height: 12 }} />
          <span>Writing the update…</span>
        </div>
      );
    case "ready":
      if (nothingSure) {
        return (
          <div className="postcall-line">
            <span>Nothing clear enough to write from here</span>
            <div style={{ flex: 1 }} />
            <button type="button" className="text-action" onClick={handleReview}>
              Review in Vocify
            </button>
          </div>
        );
      }
      return (
        <>
          <div className="changes-list" style={{ height: listHeight }}>
            {groups.map((group) => (
              <div key={group.title}>
                <div className="group-label">{group.title.toUpperCase()}</div>
                {group.changes.map((change) => (
                  <ChangeRow
                    key={change.key}
                    change={change}
                    shown={getShown(change, editedValues)}
                    kept={keptChanges.has(change.key)}
                    height={getRowHeight(change, getShown(change, editedValues))}
                    open={false}
                    toggle={() => toggleChange(change.key)}
                    toggleOptions={(r) => toggleOptions(change, r)}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="postcall-actions">
            {postCall.canApprove && (
              <button
                type="button"
                className="primary-action"
                disabled={kept === 0}
                onClick={handleApprove}
                title={kept === 0 ? "Nothing ticked" : `Save ${kept} to ${postCall.crm ?? "the CRM"}`}
              >
                <Check size={9} />
                <span>{kept === 0 ? "Nothing ticked" : `Save ${kept} to ${postCall.crm ?? "the CRM"}`}</span>
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="text-action" onClick={handleReview}>
              Review in Vocify
            </button>
          </div>
        </>
      );
    case "applying":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="postcall-line">
            <span className="spinner" />
            <span>Updating {postCall.contactName ?? "the contact"} in {postCallCrmName(postCall)}…</span>
            <div style={{ flex: 1 }} />
            <button type="button" className="small-action" onClick={handleUndo}>
              Undo
            </button>
          </div>
          {postCall.undoUntil && <div className="undo-line" style={{ width: `${Math.max(0, (postCall.undoUntil - Date.now()) / 5000 * 100)}%` }} />}
        </div>
      );
    case "done":
      return (
        <div className="postcall-line">
          <Check size={11} />
          <span>{postCall.applied === 1 ? "1 field updated" : `${postCall.applied} fields updated`} in {postCallCrmName(postCall)}</span>
        </div>
      );
    case "review":
      return (
        <div className="postcall-line">
          <span>Please review in Vocify</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="text-action" onClick={handleReview}>
            Review in Vocify
          </button>
        </div>
      );
    case "internal":
      return (
        <div className="postcall-line">
          <span>Internal call</span>
        </div>
      );
  }
}

function EmailTab({
  email,
  handleOpenEmail,
  handleSkipEmail,
  handleUnskipEmail,
}: {
  email: PostCallEmail | null;
  handleOpenEmail: () => void;
  handleSkipEmail: () => void;
  handleUnskipEmail: () => void;
}) {
  if (!email) return null;
  switch (email.state) {
    case "ready":
      if (email.subject || email.preview) {
        return (
          <>
            <div className="email-box">
              {email.to && <div className="email-to">To {email.to}</div>}
              <div className="email-subject">{email.subject ?? "Follow-up"}</div>
              {email.preview && <div className="email-preview">{email.preview}</div>}
            </div>
            <div className="postcall-actions">
              <button type="button" className="primary-action" onClick={handleOpenEmail}>
                <span>Open draft</span>
              </button>
              <button type="button" className="text-action" onClick={handleSkipEmail}>
                Skip
              </button>
            </div>
          </>
        );
      }
      return (
        <div className="postcall-line">
          <span>{email.to ? `Email to ${email.to} ready` : "Email ready"}</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="small-action" onClick={handleOpenEmail}>
            Open
          </button>
          <button type="button" className="small-action" onClick={handleSkipEmail}>
            Skip
          </button>
        </div>
      );
    case "skipped":
      return (
        <div className="postcall-line">
          <span>Email skipped</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="small-action" onClick={handleUnskipEmail}>
            Undo
          </button>
        </div>
      );
    case "sent":
      return (
        <div className="postcall-line">
          <Check size={11} />
          <span>Email sent</span>
        </div>
      );
  }
}

function NotesTab({ postCall, handleOpenNotes }: { postCall: PostCallData; handleOpenNotes: () => void }) {
  return (
    <>
      {postCall.summary && <div className="notes-summary">{postCall.summary}</div>}
      <div className="postcall-actions">
        <button type="button" className="text-action" onClick={handleOpenNotes}>
          Open in Vocify
        </button>
      </div>
    </>
  );
}

function ChangeRow({
  change,
  shown: shownValue,
  kept,
  height,
  open,
  toggle,
  toggleOptions,
}: {
  change: PostCallChange;
  shown: string;
  kept: boolean;
  height: number;
  open: boolean;
  toggle: () => void;
  toggleOptions: (rect: DOMRect) => void;
}) {
  const [hoverValue, setHoverValue] = useState(false);
  const valueRef = useRef<HTMLDivElement>(null);

  const handleValueClick = () => {
    if (change.options.length === 0) {
      toggle();
    } else if (valueRef.current) {
      toggleOptions(valueRef.current.getBoundingClientRect());
    }
  };

  return (
    <div className="change-row" style={{ height }}>
      <button type="button" className="change-toggle" onClick={toggle}>
        <div className="tick" data-kept={kept}>
          {kept && <Check size={7.5} />}
        </div>
        <span className="change-label">{change.label}</span>
      </button>
      <div className="change-value" ref={valueRef} onMouseEnter={() => setHoverValue(true)} onMouseLeave={() => setHoverValue(false)} onClick={handleValueClick}>
        <span data-kept={kept}>{shownValue}</span>
        {change.from && <span className="was-text">was {change.from}</span>}
        {change.options.length > 0 && <ChevronDown size={8} data-open={open} data-hover={hoverValue} />}
      </div>
    </div>
  );
}

const OptionsPopup = ({ anchor, change, editedValues, onPick }: { ref: any; anchor: { x: number; y: number; height: number }; change: PostCallChange; editedValues: Record<string, string>; onPick: (v: string, c: PostCallChange) => void }) => {
  const selected = editedValues[change.key] ? editedValues[change.key].split(";").map((v) => v.trim()) : [];

  return (
    <div
      className="options-popup"
      style={{
        top: `${anchor.y + anchor.height + 8}px`,
        left: `${anchor.x - L.optionsPadding - 8}px`,
      }}
    >
      {change.options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="option-row"
          data-selected={selected.includes(opt.value)}
          onClick={() => onPick(opt.value, change)}
        >
          <Check size={10} />
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
};
