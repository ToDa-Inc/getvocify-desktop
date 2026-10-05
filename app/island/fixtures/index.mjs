// Island states, one per screen the Mac island can show. `expect` sizes are worked out by hand
// from the Swift rules in IslandGeometry.size, so they check the port rather than repeat it.
export const NOW = 1_700_000_000_000;

const NOTCH = { notchWidth: 185, barHeight: 32, screenHeight: 982 };
const BAR_ONLY = { notchWidth: 0, barHeight: 30, screenHeight: 900 };

const base = {
  mode: { kind: "idle" },
  expanded: false,
  paused: false,
  recorderReady: true,
  callAudioLost: false,
  callContact: null,
  clock: null,
  levels: { you: 0, them: 0, side: "them", at: NOW },
  turns: [],
  assist: null,
  lastHelp: null,
  typeMenu: null,
  liveHelp: null,
  countdown: null,
  geometry: NOTCH,
  postCall: null,
  material: "vibrancy",
  reduceMotion: true,
};

const clock = (seconds, extra = {}) => ({ startedAt: NOW - seconds * 1000, pausedMs: 0, pausedAt: null, ...extra });

const turns = [
  { id: "t1", you: true, label: null, text: "Hi Marta, thanks for making time today. How is the quarter going?", pending: "" },
  { id: "t2", you: false, label: "Marta Ruiz", text: "Busy, honestly. We are still deciding whether to move the whole team off the old CRM before the summer.", pending: "" },
  { id: "t3", you: true, label: null, text: "That is exactly what I wanted to dig into. What is the main blocker today?", pending: "" },
  { id: "t4", you: false, label: "Marta Ruiz", text: "Mainly price. Pues, también nos preocupa la migración de los datos y quién lo va a hacer.", pending: "" },
  { id: "t5", you: true, label: null, text: "Understood.", pending: "we can cover migration for you and" },
  { id: "t6", you: false, label: "Marta Ruiz", text: "", pending: "and how long would that" },
];

const typeMenu = {
  title: "Discovery call",
  placeholder: false,
  sparkle: true,
  rows: [
    { key: null, label: "Let Vocify decide", checked: false, suggested: false },
    { key: "discovery", label: "Discovery call", checked: false, suggested: true },
    { key: "demo", label: "Demo", checked: false, suggested: false },
    { key: "follow_up", label: "Follow-up", checked: false, suggested: false },
    { key: "internal", label: "Internal", checked: false, suggested: false },
  ],
};

const postCall = (stage, extra = {}) => ({
  stage, memoId: "memo-1", contactName: "Marta Ruiz", changes: [], canApprove: false, applied: null, undoUntil: null, note: null,
  email: null, meeting: null, notes: false, summary: null, crm: "HubSpot", offerStopEmails: false, type: null, ...extra,
});

const postCallChanges = [
  {
    key: "contact:title",
    label: "Title",
    object: "contact",
    from: "Manager",
    to: "Director of Sales",
    value: "Director of Sales",
    options: [
      { value: "director", label: "Director" },
      { value: "manager", label: "Manager" },
      { value: "individual_contributor", label: "Individual Contributor" },
    ],
    multiple: false,
    check: false,
  },
  {
    key: "contact:interests",
    label: "Interests",
    object: "contact",
    from: null,
    to: "CRM;Sales automation",
    value: "CRM;Sales automation",
    options: [
      { value: "crm", label: "CRM" },
      { value: "sales_automation", label: "Sales automation" },
      { value: "analytics", label: "Analytics" },
      { value: "reporting", label: "Reporting" },
    ],
    multiple: true,
    check: false,
  },
  {
    key: "contact:needs_review",
    label: "Something unclear",
    object: "contact",
    from: null,
    to: "Budget approval pending",
    value: "Budget approval pending",
    options: [],
    multiple: false,
    check: true,
  },
  {
    key: "company:industry",
    label: "Industry",
    object: "company",
    from: "Manufacturing",
    to: "Software",
    value: "Software",
    options: [],
    multiple: false,
    check: false,
  },
  {
    key: "deal:stage",
    label: "Stage",
    object: "deal",
    from: "Qualification",
    to: "Needs Analysis",
    value: "Needs Analysis",
    options: [],
    multiple: false,
    check: false,
  },
];

const answer = {
  label: "Price objection",
  isQuestion: false,
  drafting: false,
  bridge: "That is a fair concern, let me put it in context.",
  sayThis: "Most teams recover the cost in the first quarter because reps stop doing manual CRM updates. Want me to show the numbers for a team your size?",
  thenAsk: "How many reps would use it?",
};

export const fixtures = [
  // idle
  { name: "idle-closed", state: {}, expect: { width: 257, height: 32 } },
  { name: "idle-closed-bar-only", state: { geometry: BAR_ONLY }, expect: { width: 84, height: 30 } },
  { name: "idle-open", state: { expanded: true }, expect: { width: 380, height: 88 } },
  { name: "idle-open-signed-out", state: { expanded: true, recorderReady: false }, expect: { width: 380, height: 88 } },
  { name: "idle-open-opaque-material", state: { expanded: true, material: "opaque" }, expect: { width: 380, height: 88 } },
  // call detected
  { name: "call-closed", state: { mode: { kind: "call", caller: { name: "Zoom" } } }, expect: { width: 277, height: 32 } },
  { name: "call-open-contact", state: { mode: { kind: "call", caller: { name: "Google Chrome" } }, expanded: true, callContact: "Marta Ruiz · Acme Logistics" }, expect: { width: 380, height: 88 } },
  { name: "call-open-app-only", state: { mode: { kind: "call", caller: { name: "Zoom" } }, expanded: true }, expect: { width: 380, height: 88 } },
  { name: "call-open-signed-out", state: { mode: { kind: "call", caller: { name: "Zoom" } }, expanded: true, recorderReady: false }, expect: { width: 380, height: 88 } },
  // starting
  { name: "starting", state: { mode: { kind: "starting" } }, expect: { width: 349, height: 32 } },
  // recording closed
  { name: "recording-closed", state: { mode: { kind: "recording" }, clock: clock(754), levels: { you: 0.5, them: 0, side: "you", at: NOW } }, expect: { width: 349, height: 32 } },
  { name: "recording-closed-hour", state: { mode: { kind: "recording" }, clock: clock(3725), levels: { you: 0, them: 0.6, side: "them", at: NOW } }, expect: { width: 349, height: 32 } },
  { name: "recording-closed-help-ready", state: { mode: { kind: "recording" }, clock: clock(300), assist: answer, levels: { you: 0, them: 0.4, side: "them", at: NOW } }, expect: { width: 349, height: 32 } },
  { name: "recording-closed-audio-lost", state: { mode: { kind: "recording" }, clock: clock(95), callAudioLost: true, levels: { you: 0.3, them: 0, side: "you", at: NOW } }, expect: { width: 349, height: 32 } },
  { name: "recording-closed-paused", state: { mode: { kind: "recording" }, clock: clock(412, { pausedAt: NOW }), paused: true }, expect: { width: 349, height: 32 } },
  { name: "recording-closed-bar-only", state: { geometry: BAR_ONLY, mode: { kind: "recording" }, clock: clock(754), levels: { you: 0.5, them: 0, side: "you", at: NOW } }, expect: { width: 176, height: 30 } },
  // recording open
  { name: "recording-open-empty", state: { mode: { kind: "recording" }, expanded: true, clock: clock(3) }, expect: { width: 460, height: 400 } },
  { name: "recording-open-conversation", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true, levels: { you: 0, them: 0.5, side: "them", at: NOW } }, expect: { width: 460, height: 400 } },
  { name: "recording-open-help-answer", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true, assist: answer }, expect: { width: 460, height: 400 } },
  { name: "recording-open-help-drafting", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true, assist: { ...answer, drafting: true, sayThis: "" } }, expect: { width: 460, height: 400 } },
  { name: "recording-open-help-earlier", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true, lastHelp: answer }, expect: { width: 460, height: 400 } },
  { name: "recording-open-help-off", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: false }, expect: { width: 460, height: 400 } },
  { name: "recording-open-type-list", state: { mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true }, steps: [".type-tag-button"], expect: { width: 460, height: 400 } },
  { name: "recording-open-audio-lost", state: { mode: { kind: "recording" }, expanded: true, clock: clock(95), turns: turns.slice(0, 2), typeMenu, liveHelp: true, callAudioLost: true }, expect: { width: 460, height: 400 } },
  { name: "recording-open-paused", state: { mode: { kind: "recording" }, expanded: true, clock: clock(412, { pausedAt: NOW }), paused: true, turns: turns.slice(0, 4), typeMenu, liveHelp: true }, expect: { width: 460, height: 400 } },
  { name: "recording-open-bar-only", state: { geometry: BAR_ONLY, mode: { kind: "recording" }, expanded: true, clock: clock(754), turns, typeMenu, liveHelp: true, material: "opaque" }, expect: { width: 460, height: 400 } },
  // stopped
  { name: "stopped-open-manual", state: { mode: { kind: "stopped", title: "Recording stopped" }, expanded: true, clock: clock(754, { pausedAt: NOW }), countdown: { total: 5, remaining: 3, runningSince: null } }, expect: { width: 380, height: 88 } },
  { name: "stopped-open-hangup", state: { mode: { kind: "stopped", title: "Call ended" }, expanded: true, clock: clock(1810, { pausedAt: NOW }) }, expect: { width: 380, height: 88 } },
  // post-call (closed only in previous slice)
  { name: "postcall-closed-writing", state: { mode: { kind: "postCall" }, postCall: postCall("writing") }, expect: { width: 277, height: 32 } },
  { name: "postcall-closed-ready-3", state: { mode: { kind: "postCall" }, postCall: postCall("ready", { email: { state: "ready", to: "marta@acme.com", subject: "Next steps", preview: "Hi Marta, thanks for the time today" }, meeting: { state: "pending", when: "Thursday 10:00" } }) }, expect: { width: 277, height: 32 } },
  { name: "postcall-closed-done", state: { mode: { kind: "postCall" }, postCall: postCall("done", { applied: 4 }) }, expect: { width: 277, height: 32 } },
  // post-call open
  { name: "postcall-open-writing", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("writing") }, expect: { width: 420, height: 200 }, fit: true },
  { name: "postcall-open-ready", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 4), canApprove: true }) }, expect: { width: 420, height: 380 }, fit: true },
  { name: "postcall-open-ready-all-changes", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges, canApprove: true }) }, expect: { width: 420, height: 450 }, fit: true },
  { name: "postcall-open-applying", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("applying", { undoUntil: NOW + 3500 }) }, expect: { width: 420, height: 200 }, fit: true },
  { name: "postcall-open-done", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("done", { applied: 4 }) }, expect: { width: 420, height: 200 }, fit: true },
  { name: "postcall-open-review", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("review") }, expect: { width: 420, height: 200 }, fit: true },
  { name: "postcall-open-internal", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("internal") }, expect: { width: 420, height: 200 }, fit: true },
  { name: "postcall-open-type-open", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, type: { key: "discovery", label: "Discovery call", options: [{ key: "discovery", label: "Discovery call" }, { key: "demo", label: "Demo" }, { key: "follow_up", label: "Follow-up" }] } }) }, expect: { width: 420 }, fit: true, steps: [".type-tag"] },
  { name: "postcall-open-option-open", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true }) }, expect: { width: 420 }, fit: true, steps: [".change-row .change-value"] },
  { name: "postcall-open-email-ready", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, email: { state: "ready", to: "marta@acme.com", subject: "Next steps", preview: "Hi Marta, thanks for the time today. Let's move forward with the pilot." } }) }, expect: { width: 420 }, fit: true, steps: [".postcall-tab:nth-child(2)"] },
  { name: "postcall-open-email-skipped", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, email: { state: "skipped", to: null, subject: null, preview: null } }) }, expect: { width: 420 }, fit: true, steps: [".postcall-tab:nth-child(2)"] },
  { name: "postcall-open-email-sent", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, email: { state: "sent", to: null, subject: null, preview: null } }) }, expect: { width: 420 }, fit: true, steps: [".postcall-tab:nth-child(2)"] },
  { name: "postcall-open-meeting-added", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, meeting: { state: "added", when: "Thursday 10:00" } }) }, expect: { width: 420 }, fit: true },
  { name: "postcall-open-meeting-check", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, meeting: { state: "check", when: "Thursday 10:00" } }) }, expect: { width: 420 }, fit: true },
  { name: "postcall-open-notes-tab", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: postCallChanges.slice(0, 2), canApprove: true, summary: "Discussed CRM migration timeline. Team concerned about data migration and costs. Marta interested in pilot next quarter.", notes: true }) }, expect: { width: 420 }, fit: true, steps: [".postcall-tab:nth-child(2)"] },
  { name: "postcall-open-nothing-sure", state: { mode: { kind: "postCall" }, expanded: true, postCall: postCall("ready", { changes: [], canApprove: false }) }, expect: { width: 420 }, fit: true },
].map((fixture) => ({ ...fixture, state: { ...base, ...fixture.state } }));

// Interactions: a click must send exactly this action, and a button inside the top bar must not also toggle it.
export const interactions = [
  { name: "stop-button-stops", fixture: "recording-open-conversation", click: ".stop-button", expect: [{ name: "stop" }] },
  { name: "pause-button-pauses", fixture: "recording-open-conversation", click: ".circle-button", expect: [{ name: "togglePause" }] },
  { name: "live-help-toggle", fixture: "recording-open-conversation", click: ".live-help-toggle", expect: [{ name: "toggleLiveHelp" }] },
  { name: "open-vocify", fixture: "recording-open-conversation", click: ".controls .icon-button", expect: [{ name: "openApp" }] },
  { name: "topbar-toggles", fixture: "recording-closed", click: ".topbar", expect: [{ name: "toggle" }] },
  { name: "record-dot-records-only", fixture: "call-closed", click: ".record-dot", expect: [{ name: "record" }] },
  { name: "record-button-records-only", fixture: "call-open-contact", click: ".quiet-record", expect: [{ name: "record" }] },
  { name: "skip-call", fixture: "call-open-contact", click: ".menu .icon-button", expect: [{ name: "dismissCall" }] },
  { name: "idle-record", fixture: "idle-open", click: ".quiet-record", expect: [{ name: "record" }] },
  { name: "resume-after-stop", fixture: "stopped-open-manual", click: ".primary-action", expect: [{ name: "resume" }] },
  { name: "pick-type", fixture: "recording-open-type-list", click: ".type-row:nth-child(3)", expect: [{ name: "pickCallType", key: "demo" }], after: true },
];
