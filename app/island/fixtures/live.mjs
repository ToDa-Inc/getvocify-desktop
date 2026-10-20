// The live call assistant's states (spec 2026-10-16-live-call-assistant-design.md, "States to port as fixtures"), each at
// 460 x 400 (Conversación 460 x 460). The sample call is invented: a cold call to Marta Ruiz at Acme Logistics, with the
// shape of the playbook Vocify ships (steps with an example, qualification with a question each). Nothing here comes from a
// real call. `steps` are clicks that set the scene; `next` is a second state pushed after them (a point that ends).
const NOW = 1_700_000_000_000;
const NOTCH = { notchWidth: 185, barHeight: 32, screenHeight: 982 };

const CALL_SECONDS = 150;

const base = {
  mode: { kind: "recording" },
  expanded: true,
  paused: false,
  recorderReady: true,
  callAudioLost: false,
  micSilent: false,
  callContact: null,
  clock: { startedAt: NOW - CALL_SECONDS * 1000, pausedMs: 0, pausedAt: null },
  levels: { you: 0, them: 0.4, side: "them", at: NOW },
  turns: [
    { id: "t1", you: true, label: null, text: "Hola Marta, soy Dani de Vocify. ¿Te pillo en buen momento?", pending: "" },
    { id: "t2", you: false, label: "Marta Ruiz", text: "La verdad es que estoy con otra cosa, pero dime.", pending: "" },
    { id: "t3", you: true, label: null, text: "Te robo un minuto. Vemos que en los equipos de campo el CRM se rellena tarde o nunca.", pending: "" },
    { id: "t4", you: false, label: "Marta Ruiz", text: "Mándame un email y se lo reenvío a la directora comercial, que es quien decide esto.", pending: "" },
    { id: "t5", you: true, label: null, text: "Claro. ¿Qué CRM usáis hoy?", pending: "" },
    { id: "t6", you: false, label: "Marta Ruiz", text: "Usamos HubSpot. ¿Se integra con HubSpot lo vuestro? ¿Y cuánto cuesta?", pending: "" },
  ],
  assist: null,
  lastHelp: null,
  typeMenu: {
    title: "Llamada en frío",
    placeholder: false,
    proposed: true,
    rows: [
      { key: "cold", label: "Llamada en frío", checked: true },
      { key: "closing", label: "Demo y cierre", checked: false },
    ],
    channel: { title: "Llamada", rows: [{ key: "call", label: "Llamada", checked: true }, { key: "meeting", label: "Reunión", checked: false }] },
  },
  liveHelp: true,
  countdown: null,
  geometry: NOTCH,
  postCall: null,
  finish: null,
  onScreen: null,
  dial: null,
  meeting: null,
  crmBlocked: null,
  keypadOpen: false,
  material: "vibrancy",
  reduceMotion: true,
  language: "es",
  liveTab: "transcript",
};

/* ---------- the brain's output ---------- */

const point = (id, kind, tag, title, saidAt, extra = {}) => ({
  id, kind, tag, tagKey: kind === "question" ? "question" : tag ? "custom" : "other", title, saidAt, decision: null, decisionNote: null, answer: null, fallback: null, gap: null, source: null,
  phase: "ready", outcome: "open", repeated: false, draft: false, ...extra,
});
/** What the model is writing right now (no tag yet): thinking with no words, writing with some. */
const draft = (title, say) => point("draft:0", "question", null, title, Number.MAX_SAFE_INTEGER, { draft: true, phase: say ? "writing" : "thinking", answer: say });

const HUBSPOT = point("hubspot", "question", null, "¿se integra con HubSpot?", 142, {
  answer: "Sí, se integra con HubSpot: lo que se dice en la llamada queda en el CRM sin que nadie lo apunte.",
  source: "Conocimiento · Integraciones",
});
const PRICE = point("price", "question", null, "¿y cuánto cuesta?", 145, {
  decision: "reconducir",
  decisionNote: "Antes de dar precio: falta el dolor",
  answer: "Depende del número de comerciales. ¿Cuántos sois, y cuántos están en la calle?",
  source: "Playbook · Precio",
});
const TIMING = point("timing", "objection", "Momento", "estoy con otra cosa", 118, {
  answer: "Sin problema, no te robo más. ¿Buscamos 20 minutos el jueves o el viernes?",
  source: "Playbook · Momento",
  outcome: "answered",
});
const EMAIL = point("email", "objection", "Mándame información por email", "mándame un email", 128, {
  answer: "Claro, te lo mando. Aunque esos correos acaban en un agujero negro: ¿agendamos 15 minutos y lo vemos?",
  source: "Playbook · Mándame información por email",
});
const AUTHORITY = point("authority", "objection", "Quién decide", "se lo reenvío a la directora comercial", 130, {
  answer: "Perfecto. ¿Qué crees que le preocuparía más a ella? Si quieres, hacemos la reunión con las dos.",
  source: "Playbook · Quién decide",
});
const SINCE = point("since", "question", null, "¿desde cuándo existís?", 70, {
  fallback: "Te lo confirmo, pero lo importante: ya trabajamos con equipos comerciales en piloto.",
  gap: "La fecha no está en tu conocimiento",
  outcome: "unanswered",
});
const SINCE_OPEN = { ...SINCE, outcome: "open" };
const TEAM = point("team", "question", null, "¿cuántos sois?", 90, {
  fallback: "Un equipo pequeño de fundadores que hemos sido comerciales. Te paso el detalle.",
  gap: "El equipo no está en tu conocimiento",
  outcome: "promised",
});

const step = (id, label, concept, criterion, example, extra = {}) => ({ id, label, concept, criterion, example, done: false, byRep: false, quote: null, ...extra });
const data = (id, label, good, question, extra = {}) => ({ id, label, good, question, done: false, byRep: false, value: null, quote: null, reread: false, ...extra });

const STEPS = [
  step("apertura_con_marco", "Apertura con marco", "Preséntate y di que será breve", "Se presenta y pide permiso.", "Hola Marta, soy Dani de Vocify. Te robo un minuto y me dices si tiene sentido.", { done: true, quote: "«Te robo un minuto»" }),
  step("motivo_personalizado", "Motivo personalizado", "Di por qué le llamas a ella", "Da un motivo propio para llamarle.", "He visto que diriges operaciones en Acme y por eso te llamo.", { done: true, quote: "«soy Dani de Vocify»" }),
  step("plantear_el_problema", "Plantear el problema", "Cuenta el problema como algo común", "Plantea el problema como algo que le pasa a todos.", "Lo que vemos en los equipos comerciales es que el CRM se rellena tarde o nunca."),
  step("preguntar_tiempo_y_proceso", "Preguntar tiempo y proceso", "Pregunta cuánto tardan hoy en el CRM", "Pregunta cuánto tiempo dedican hoy.", "¿Cuánto tiempo le lleva a cada comercial apuntar una visita en el CRM?"),
  step("dejar_hablar", "Dejar hablar y profundizar", "Repregunta sobre lo que acaba de decir", "Repregunta sobre la última respuesta.", "Cuéntame más sobre eso."),
  step("cualificar_el_encaje", "Cualificar el encaje", "Comerciales, calle u oficina, CRM, quién decide", "Averigua el tamaño y quién decide.", "Para ver si tiene sentido: ¿cuántos comerciales sois y quién decide una herramienta así?"),
  step("proponer_reunion", "Proponer la reunión", "Propón un día y una hora", "Cierra con una reunión con día y hora.", "¿Te va bien el jueves a las 10 o prefieres el viernes?"),
];

const DATA = [
  data("n_comerciales", "N.º de comerciales", "Cuántos comerciales hay en el equipo.", "¿Cuántos comerciales sois, y cuántos están en la calle y cuántos en oficina?"),
  data("crm_que_usan", "CRM que usan", "Qué CRM usan y si lo rellenan.", "¿Qué CRM usáis, y lo rellenan de verdad?", { done: true, value: "HubSpot", quote: "«Usamos HubSpot»" }),
  data("tiempo_en_el_crm", "Tiempo en el CRM", "Cuánto tardan en apuntar cada visita.", "¿Cuánto les lleva apuntar cada visita, y cuándo lo hacen?"),
  data("quien_decide", "Quién decide la compra", "Quién aprueba la compra.", "¿Quién tendría que aprobarlo, y estaría en la reunión?", { done: true, value: "La directora comercial", quote: "«se lo reenvío a la directora comercial»" }),
];

const GOAL = { label: "Reunión con día y hora", done: false, byRep: false, value: null, quote: null };

const progress = (extra = {}) => ({
  playbook: { key: "cold", name: "Llamada en frío" },
  hasPlaybook: true,
  steps: STEPS,
  data: DATA,
  goal: GOAL,
  missing: ["plantear_el_problema", "preguntar_tiempo_y_proceso"],
  now: { kind: "step", id: "plantear_el_problema", say: "Lo que vemos en los equipos comerciales es que el CRM se rellena tarde o nunca." },
  ...extra,
});

const view = (points = [], extra = {}) => ({ on: true, points, progress: progress(), asks: { responder: null, recap: null }, offlineSince: null, ...extra });
const asks = (extra) => ({ asks: { responder: null, recap: null, ...extra } });
const RECAP = {
  seq: 1, status: "ready", upTo: 140,
  lines: ["Marta Ruiz, de Acme Logistics.", "Le pillas ocupado, haciendo otra cosa.", "Pide la información por email. Decide la directora comercial: ella se la reenviará.", "Usan HubSpot."],
  unknown: ["N.º de comerciales", "Tiempo en el CRM"],
};

const recording = (live, extra = {}) => ({ ...base, live, ...extra });
const FIXED = { width: 460, height: 400 };
const TALL = { width: 460, height: 460 };
const help = { liveTab: "help" };
const conversation = { liveTab: "conversation" };
/** Nothing missing that matters: no "Falta" chip, no count on Conversación. */
const QUIET = progress({ missing: [], now: null });

export const liveFixtures = [
  // the transcript, with and without the chip
  { name: "live-transcript", state: recording(view([], { progress: QUIET })), expect: { ...FIXED, live: { tab: "transcript", chip: null, badges: [] } } },
  { name: "live-transcript-chip", state: recording(view([HUBSPOT, PRICE])), expect: { ...FIXED, live: { tab: "transcript", chip: "2 por responder", badges: ["2", "2"] } } },
  { name: "live-transcript-chip-missing", state: recording(view([TIMING])), expect: { ...FIXED, live: { tab: "transcript", chip: "Falta", badges: ["2"] } } },
  // Ayuda
  { name: "live-help-empty", state: recording(view(), help), expect: { ...FIXED, live: { tab: "help", cards: 0, empty: "Aquí aparecen las respuestas a sus preguntas y objeciones." } } },
  { name: "live-help-thinking", state: recording(view([point("p", "question", null, "¿se integra con HubSpot?", 142, { phase: "thinking" })]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, thinking: 1 } } },
  { name: "live-help-draft-thinking", state: recording(view([draft("", null)]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, thinking: 1, tag: null } } },
  { name: "live-help-draft-writing", state: recording(view([HUBSPOT, draft("¿y cuánto cuesta?", "Depende del número de comerciales. ¿Cuántos so")]), help), expect: { ...FIXED, live: { tab: "help", cards: 2, caret: true } } },
  { name: "live-help-writing", state: recording(view([point("p", "question", null, "¿se integra con HubSpot?", 142, { phase: "writing", answer: "Sí, se integra con HubSpot: lo que se dice en la llamada queda" })]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, caret: true } } },
  { name: "live-help-one-card", state: recording(view([HUBSPOT]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, say: HUBSPOT.answer } } },
  { name: "live-help-decision", state: recording(view([PRICE]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, decision: "Antes de dar precio: falta el dolor" } } },
  { name: "live-help-two-cards", state: recording(view([HUBSPOT, PRICE]), help), expect: { ...FIXED, live: { tab: "help", cards: 2, lines: 0 } } },
  { name: "live-help-three-points", state: recording(view([EMAIL, AUTHORITY, PRICE]), help), expect: { ...FIXED, live: { tab: "help", cards: 2, lines: 1 } } },
  { name: "live-help-no-knowledge", state: recording(view([SINCE_OPEN]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, gap: "No está en tu conocimiento" } } },
  { name: "live-help-repeated", state: recording(view([point("again", "question", null, "¿y cuánto cuesta?", 145, { repeated: true, answer: PRICE.answer, source: PRICE.source })]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, tag: "Lo repite" } } },
  // a card folding away (motion on, a frame into the fold) and the same with reduced motion
  { name: "live-help-folding", state: recording(view([HUBSPOT, PRICE]), { ...help, reduceMotion: false }), next: recording(view([{ ...HUBSPOT, outcome: "answered" }, PRICE]), { ...help, reduceMotion: false }), expect: { ...FIXED, live: { tab: "help", folding: 1 } } },
  { name: "live-help-folded-reduced", state: recording(view([HUBSPOT, PRICE]), help), next: recording(view([{ ...HUBSPOT, outcome: "answered" }, PRICE]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, earlier: 1 } } },
  // Antes, with a point that ended unanswered
  { name: "live-help-before-closed", state: recording(view([TIMING, SINCE, TEAM, HUBSPOT]), help), expect: { ...FIXED, live: { tab: "help", cards: 1, earlier: 3, unanswered: "1 sin responder", earlierOpen: false } } },
  { name: "live-help-before-open", state: recording(view([TIMING, SINCE, TEAM, HUBSPOT]), help), steps: [".live-earlier .live-section-toggle"], expect: { ...FIXED, live: { tab: "help", cards: 1, earlier: 3, earlierOpen: true, outcomes: ["Respondido", "Sin responder", "Prometido"] } } },
  // Conversación
  { name: "live-conv", state: recording(view(), conversation), expect: { ...TALL, live: { tab: "conversation", now: "Plantear el problema", rows: 3, more: "+4 más", count: "4 de 12" } } },
  { name: "live-conv-more-open", state: recording(view(), conversation), steps: [".live-more"], expect: { ...TALL, live: { tab: "conversation", rows: 7, more: "Ver menos" } } },
  { name: "live-conv-done-open", state: recording(view(), conversation), steps: [".live-done .live-section-toggle"], expect: { ...TALL, live: { tab: "conversation", doneOpen: true, doneRows: 4 } } },
  { name: "live-conv-ask-open", state: recording(view(), conversation), steps: [".live-todo-wrap .live-todo-open"], expect: { ...TALL, live: { tab: "conversation", askOpen: true } } },
  { name: "live-conv-no-steps", state: recording({ ...view(), progress: progress({ steps: [], missing: ["n_comerciales", "tiempo_en_el_crm"], now: null }) }, conversation), expect: { ...TALL, live: { tab: "conversation", now: "Averiguar · N.º de comerciales", rows: 2 } } },
  { name: "live-conv-no-playbook", state: recording({ ...view(), progress: { playbook: { key: "internal", name: "Interna" }, hasPlaybook: false, steps: [], data: [], goal: null, missing: [], now: null } }, conversation), expect: { ...TALL, live: { tab: "conversation", noPlaybook: "Interna no tiene playbook", disabled: ["Preguntar"] } } },
  { name: "live-conv-type-change", state: recording({ ...view(), progress: progress({ playbook: { key: "closing", name: "Demo y cierre" }, steps: STEPS.map((s) => ({ ...s, done: false, quote: null })), data: DATA.map((d) => (d.id === "quien_decide" ? { ...d, reread: true } : { ...d, done: false, value: null, quote: null })), missing: ["plantear_el_problema"] }) }, { ...conversation, typeMenu: { ...base.typeMenu, title: "Demo y cierre", note: { id: 1, kind: "change", label: "Demo y cierre" } } }), expect: { ...TALL, live: { tab: "conversation", name: "Demo y cierre" } } },
  // the peek
  { name: "live-peek-point", state: recording(view([HUBSPOT, PRICE])), steps: [".live-chip"], expect: { ...FIXED, live: { tab: "transcript", peek: true, peekCards: 1 } } },
  { name: "live-peek-now", state: recording(view([TIMING])), steps: [".live-chip"], expect: { ...FIXED, live: { tab: "transcript", peek: true, peekNow: "Plantear el problema" } } },
  { name: "live-peek-now-asked", state: recording(view(), help), steps: [".live-action:nth-child(2)"], expect: { ...FIXED, live: { tab: "help", peek: true, peekNow: "Plantear el problema", on: ["Preguntar"] } } },
  { name: "live-peek-recap-reading", state: recording(view()), steps: [".live-action:nth-child(3)"], expect: { ...FIXED, live: { tab: "transcript", peek: true, peekReading: "Resumiendo" } } },
  { name: "live-peek-recap", state: recording(view()), steps: [".live-action:nth-child(3)"], next: recording(view([], asks({ recap: RECAP }))), expect: { ...FIXED, live: { tab: "transcript", peek: true, recapLines: 4, recapPending: "Aún no sabes: N.º de comerciales, Tiempo en el CRM." } } },
  { name: "live-peek-recap-closed-again", state: recording(view()), steps: [".live-action:nth-child(3)", ".live-action:nth-child(3)"], expect: { ...FIXED, live: { tab: "transcript", peek: false } } },
  { name: "live-peek-respond-reading", state: recording(view()), steps: [".live-action:nth-child(1)"], expect: { ...FIXED, live: { tab: "transcript", peek: true, peekReading: "Leyendo el último minuto" } } },
  { name: "live-peek-respond-nothing", state: recording(view()), steps: [".live-action:nth-child(1)"], next: recording(view([], asks({ responder: { seq: 1, status: "nothing", pointId: null } }))), expect: { ...FIXED, live: { tab: "transcript", peek: true, peekNothing: "No encuentro una pregunta ni una objeción en el último minuto." } } },
  { name: "live-peek-respond-found", state: recording(view([HUBSPOT])), steps: [".live-action:nth-child(1)"], expect: { ...FIXED, live: { tab: "transcript", peek: true, peekCards: 1 } } },
  // an older point the rep asks about: the dashboard's reading finds it (it is in the peek, or pulses in place in Ayuda)
  { name: "live-peek-respond-brain-found", state: recording(view([{ ...HUBSPOT, saidAt: 20 }])), steps: [".live-action:nth-child(1)"], next: recording(view([{ ...HUBSPOT, saidAt: 20 }], asks({ responder: { seq: 1, status: "found", pointId: "hubspot" } }))), expect: { ...FIXED, live: { tab: "transcript", peek: true, peekCards: 1 } } },
  { name: "live-help-respond-brain-found", state: recording(view([{ ...HUBSPOT, saidAt: 20 }]), help), steps: [".live-action:nth-child(1)"], next: recording(view([{ ...HUBSPOT, saidAt: 20 }], asks({ responder: { seq: 1, status: "found", pointId: "hubspot" } })), help), expect: { ...FIXED, live: { tab: "help", peek: false, cards: 1 } } },
  { name: "live-peek-respond-in-help-pulses", state: recording(view([HUBSPOT]), help), steps: [".live-action:nth-child(1)"], expect: { ...FIXED, live: { tab: "help", peek: false, cards: 1 } } },
  { name: "live-peek-reopens-closed", state: recording(view([{ ...HUBSPOT, outcome: "answered" }]), help), steps: [".live-action:nth-child(1)"], expect: { ...FIXED, live: { tab: "help", peek: false, cards: 1 } } },
  { name: "live-peek-closed-point", state: recording(view([HUBSPOT, PRICE])), steps: [".live-chip"], next: recording(view([HUBSPOT, { ...PRICE, outcome: "answered" }])), expect: { ...FIXED, live: { tab: "transcript", peek: true, peekDone: "Pregunta · Respondido" } } },
  // offline, live help off
  { name: "live-help-offline", state: recording(view([HUBSPOT], { offlineSince: NOW - 12_000 }), help), expect: { ...FIXED, live: { tab: "help", offline: "Sin conexión con Vocify", cards: 1 } } },
  { name: "live-conv-offline", state: recording(view([], { offlineSince: NOW - 12_000 }), conversation), expect: { ...TALL, live: { tab: "conversation", offline: "Sin conexión con Vocify" } } },
  { name: "live-help-off-by-the-brain", state: recording(view([HUBSPOT], { on: false }), help), expect: { ...FIXED, live: { tab: "help", empty: "La ayuda en vivo está apagada en esta llamada.", disabled: ["Responder", "Preguntar", "Resumen"], badges: [] } } },
  { name: "live-help-off", state: recording(view([HUBSPOT]), { ...help, liveHelp: false }), expect: { ...FIXED, live: { tab: "help", empty: "La ayuda en vivo está apagada en esta llamada.", disabled: ["Responder", "Preguntar", "Resumen"], badges: [] } } },
  { name: "live-conv-off", state: recording(view(), { ...conversation, liveHelp: false }), expect: { ...TALL, live: { tab: "conversation", empty: "La ayuda en vivo está apagada en esta llamada." } } },
  // English
  { name: "live-help-english", state: recording(view([HUBSPOT, PRICE]), { ...help, language: "en" }), expect: { ...FIXED, live: { tab: "help", cards: 2, tabLabels: ["Transcript", "Help", "Conversation"] } } },
  // a small screen: the island is never over half of it
  { name: "live-conv-small-screen", state: recording(view(), { ...conversation, geometry: { ...NOTCH, screenHeight: 800 } }), expect: { width: 460, height: 400, live: { tab: "conversation" } } },
];

const NOW_ASK = { name: "liveAsk", ask: "now" };

export const liveInteractions = [
  { name: "live-tab-help", fixture: "live-transcript", click: ".live-tab:nth-child(2)", expect: [{ name: "liveTab", tab: "help" }] },
  { name: "live-tab-conversation", fixture: "live-transcript", click: ".live-tab:nth-child(3)", expect: [{ name: "liveTab", tab: "conversation" }] },
  { name: "live-respond", fixture: "live-transcript", click: ".live-action:nth-child(1)", expect: [{ name: "liveAsk", ask: "respond" }] },
  { name: "live-ask-now", fixture: "live-transcript", click: ".live-action:nth-child(2)", expect: [NOW_ASK] },
  { name: "live-ask-now-twice-closes", fixture: "live-transcript", before: [".live-action:nth-child(2)"], click: ".live-action:nth-child(2)", expect: [] },
  { name: "live-recap", fixture: "live-transcript", click: ".live-action:nth-child(3)", expect: [{ name: "liveAsk", ask: "recap" }] },
  { name: "live-dismiss-point", fixture: "live-help-one-card", click: ".live-dismiss", expect: [{ name: "liveDismiss", id: "hubspot" }] },
  { name: "live-tick-now", fixture: "live-conv", click: ".live-now .live-close", expect: [{ name: "liveTick", kind: "step", id: "plantear_el_problema", on: true }] },
  { name: "live-tick-missing", fixture: "live-conv", click: ".live-todo-wrap .live-node", expect: [{ name: "liveTick", kind: "step", id: "preguntar_tiempo_y_proceso", on: true }] },
  { name: "live-untick-done", fixture: "live-conv-done-open", click: ".live-done .live-node", expect: [{ name: "liveTick", kind: "step", id: "apertura_con_marco", on: false }] },
  { name: "live-tick-from-peek", fixture: "live-transcript-chip-missing", before: [".live-chip"], click: ".live-peek .live-now .live-close", expect: [{ name: "liveTick", kind: "step", id: "plantear_el_problema", on: true }] },
  { name: "live-peek-close-sends-nothing", fixture: "live-peek-point", click: ".live-peek-close", expect: [] },
];

/* ---------- the Qué decir view (spec revised 2026-10-19): the same invented call ---------- */

/** A point as the Qué decir view gets it: the bubbles it comes from and every version of what to say. */
const sayPoint = (p, turnIds, versions = [p.answer ?? p.fallback].filter(Boolean)) => ({ ...p, turnIds, versions });
const S_HUBSPOT = sayPoint(HUBSPOT, ["t6"]);
const S_HUBSPOT_TWO = sayPoint(HUBSPOT, ["t6"], [HUBSPOT.answer, "Sí, con HubSpot. Antes dime: ¿qué parte de vuestro HubSpot no queréis que se toque?"]);
const S_TIMING = sayPoint(TIMING, ["t2"]);
const S_SINCE = sayPoint(SINCE_OPEN, ["t4"]);
const S_DEEPEN = sayPoint(point("deepen", "deepen", "Dolor", "el CRM se rellena tarde o nunca", 132, {
  answer: "¿Y cuánto tiempo os lleva a la semana perseguirles para que lo rellenen?",
  source: "Playbook · Dejar hablar y profundizar",
}), ["t4"]);
const S_FRESH = sayPoint({ ...HUBSPOT, id: "fresh", saidAt: 148 }, ["t6"]);
const S_DRAFT = { ...draft("¿y cuánto cuesta?", "Depende del número de comerciales. ¿Cuántos so"), turnIds: [], versions: [] };

/** Cualificar el encaje with its parts (bastan 3 de 5), two of them heard. */
const S_STEPS = STEPS.map((s) =>
  s.id === "cualificar_el_encaje"
    ? { ...s, parts: [
        { id: "n_comerciales", label: "Comerciales", done: false, quote: null },
        { id: "calle_u_oficina", label: "Calle o teléfono", done: false, quote: null },
        { id: "crm_que_usan", label: "CRM", done: true, quote: "«Usamos HubSpot»" },
        { id: "visitas_al_dia", label: "Visitas al día", done: false, quote: null },
        { id: "quien_decide", label: "Quién decide", done: true, quote: "«se lo reenvío a la directora comercial»" },
      ], need: 3 }
    : { ...s, parts: null, need: null },
);
const CONTACT = { name: "Marta Ruiz", company: "Acme Logistics", first: false, lines: ["Hablasteis hace dos semanas: pidió que la llamaras cuando tuvieras precios.", "En HubSpot: directora de operaciones, 40 comerciales."] };
const sayView = (points = [], extra = {}) => ({
  ...view(points),
  progress: progress({ steps: S_STEPS }),
  asks: { responder: null, recap: null, next: null, step: null, rewrite: null },
  view: "say",
  contact: CONTACT,
  ...extra,
});
const sayAsks = (extra) => ({ asks: { responder: null, recap: null, next: null, step: null, rewrite: null, ...extra } });
const SAY = { width: 460, height: 400 };
const NEXT = { kind: "data", id: "n_comerciales", label: "N.º de comerciales", question: "¿Cuántos comerciales sois, y cuántos están en la calle?" };

export const sayFixtures = [
  { name: "say-empty", state: recording(sayView()), expect: { ...SAY, say: { cards: 0, quiet: "Aquí sale qué decir cuando el cliente pregunta, objeta o cuenta algo importante.", bar: ["Responder", "Resumen", "Pasos"], contact: "Marta Ruiz", peek: null } } },
  { name: "say-answer", state: recording(sayView([S_HUBSPOT])), expect: { ...SAY, say: { cards: 1, kinds: ["Respuesta"], text: HUBSPOT.answer, sources: ["t6"] } } },
  { name: "say-kinds", state: recording(sayView([S_TIMING, S_DEEPEN, S_SINCE, S_HUBSPOT])), expect: { ...SAY, say: { cards: 4, kinds: ["No está en tu conocimiento", "Respuesta", "Puedes preguntar", "Respuesta"], faded: 1 } } },
  { name: "say-writing", state: recording(sayView([S_HUBSPOT, S_DRAFT])), expect: { ...SAY, say: { cards: 2, caret: true } } },
  { name: "say-rewrite-next-version", state: recording(sayView([S_HUBSPOT_TWO])), steps: [".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { cards: 1, again: true, text: S_HUBSPOT_TWO.versions[1] } } },
  { name: "say-rewrite-asked", state: recording(sayView([S_HUBSPOT])), steps: [".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { cards: 1, otherWay: "Otra forma…" } } },
  { name: "say-rewrite-arrives", state: recording(sayView([S_HUBSPOT])), steps: [".say-bar .live-action:nth-child(1)"], next: recording(sayView([S_HUBSPOT_TWO], sayAsks({ rewrite: { seq: 1, pointId: "hubspot", status: "ready" } }))), expect: { ...SAY, say: { cards: 1, again: true, text: S_HUBSPOT_TWO.versions[1] } } },
  { name: "say-rewrite-none", state: recording(sayView([S_HUBSPOT])), steps: [".say-bar .live-action:nth-child(1)"], next: recording(sayView([S_HUBSPOT], sayAsks({ rewrite: { seq: 1, pointId: "hubspot", status: "none" } }))), expect: { ...SAY, say: { cards: 1, again: false, text: HUBSPOT.answer } } },
  { name: "say-respond-reading", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { note: "Leyendo el último minuto", on: ["Responder"] } } },
  { name: "say-respond-next", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(1)"], next: recording(sayView([], sayAsks({ responder: { seq: 1, status: "nothing", pointId: null }, next: NEXT }))), expect: { ...SAY, say: { cards: 1, kinds: ["Te falta saber"], text: NEXT.question } } },
  { name: "say-respond-next-from-playbook", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(1)"], next: recording(sayView([], sayAsks({ responder: { seq: 1, status: "nothing", pointId: null } }))), expect: { ...SAY, say: { cards: 1, kinds: ["Te falta saber"] } } },
  { name: "say-respond-reopens", state: recording(sayView([{ ...S_HUBSPOT, outcome: "answered" }])), steps: [".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { cards: 1, faded: 0 } } },
  { name: "say-recap-reading", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(2)"], expect: { ...SAY, say: { peek: "recap", peekReading: "Resumiendo", on: ["Resumen"] } } },
  { name: "say-recap", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(2)"], next: recording(sayView([], sayAsks({ recap: RECAP }))), expect: { ...SAY, say: { peek: "recap", facts: 2, recapLines: 4, title: "Resumen · hasta el 02:20" } } },
  { name: "say-steps", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(3)"], expect: { ...SAY, say: { peek: "steps", title: "Pasos · 2 de 7", rows: 8, hint: "Toca un paso pendiente y te preparo una pregunta con lo que ha dicho." } } },
  { name: "say-steps-asking", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(3)", ".say-step-ask"], expect: { ...SAY, say: { peek: "steps", stepQ: "Preparando una pregunta con lo que ha dicho" } } },
  { name: "say-steps-question", state: recording(sayView()), steps: [".say-bar .live-action:nth-child(3)", ".say-step-ask"], next: recording(sayView([], sayAsks({ step: { seq: 1, kind: "step", id: "plantear_el_problema", status: "ready", question: "Con tantos en la calle, ¿cuándo lo apuntan, al final del día?" } }))), expect: { ...SAY, say: { peek: "steps", stepQ: "Con tantos en la calle, ¿cuándo lo apuntan, al final del día?" } } },
  { name: "say-brief", state: recording(sayView()), steps: [".say-contact"], expect: { ...SAY, say: { peek: "brief", title: "Marta Ruiz · Acme Logistics", briefLines: 2 } } },
  { name: "say-brief-first", state: recording(sayView([], { contact: { ...CONTACT, first: true, lines: [] } })), steps: [".say-contact"], expect: { ...SAY, say: { peek: "brief", briefLines: 1 } } },
  { name: "say-no-contact", state: recording(sayView([], { contact: null })), expect: { ...SAY, say: { contact: null } } },
  { name: "say-offline", state: recording(sayView([S_HUBSPOT], { offlineSince: NOW - 12_000 })), expect: { ...SAY, say: { offline: "Sin conexión con Vocify", cards: 1 } } },
  { name: "say-off", state: recording(sayView([S_HUBSPOT]), { liveHelp: false }), expect: { ...SAY, say: { quiet: "La ayuda en vivo está apagada en esta llamada.", disabled: ["Responder", "Resumen", "Pasos"] } } },
  { name: "say-english", state: recording(sayView([S_DEEPEN, S_HUBSPOT]), { language: "en" }), expect: { ...SAY, say: { kinds: ["You could ask", "Answer"], bar: ["Respond", "Recap", "Steps"] } } },
  { name: "say-fresh", state: recording(sayView([S_FRESH])), expect: { ...SAY, say: { cards: 1, again: false } } },
  // A card said two seconds ago: the first press points at it (it may not have been read); the second writes it again.
  { name: "say-fresh-pointed", state: recording(sayView([S_FRESH])), steps: [".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { cards: 1, again: false } } },
  { name: "say-fresh-pressed-again", state: recording(sayView([S_FRESH])), steps: [".say-bar .live-action:nth-child(1)", ".say-bar .live-action:nth-child(1)"], expect: { ...SAY, say: { cards: 1, otherWay: "Otra forma…" } } },
];

// Closed: something new the rep has not seen marks the island (each fixture starts with nothing seen); nothing open, no mark.
const CLOSED = { width: 349, height: 32 };
sayFixtures.push(
  { name: "say-closed-marker", state: recording(sayView([S_HUBSPOT]), { expanded: false }), expect: { ...CLOSED, marker: { dot: true, wraps: true } } },
  { name: "say-closed-nothing-new", state: recording(sayView([{ ...S_HUBSPOT, outcome: "answered" }]), { expanded: false }), expect: { ...CLOSED, marker: null } },
  { name: "say-closed-tabs-keep-sparkle", state: recording(view([HUBSPOT]), { expanded: false }), expect: { ...CLOSED, marker: null } },
);

// As a pill (the setting): the window is the screen (1000 x 720 here: narrower than the 1024 px screen of the Windows CI runner, which would shrink a larger window); the pill stands 12 px from a side edge (40 x 104) or
// lies 12 px from the top or bottom one (104 x 40); the island opens out of it away from its edge, whole on the screen.
const STAGE = { width: 1000, height: 720 };
const STRIP = { width: 40, height: 104, edge: "right", gap: 12 };
const PILL = (kind = "recording", more = {}) => ({ strip: STRIP, open: false, view: false, marker: false, panel: null, inside: null, glyph: kind !== "recording", action: null, ...more });
sayFixtures.push(
  { name: "side-closed", side: true, state: recording(sayView([{ ...S_HUBSPOT, outcome: "answered" }]), { expanded: false, placement: "side" }), expect: { ...STAGE, side: PILL() } },
  { name: "side-closed-marker", side: true, state: recording(sayView([S_HUBSPOT]), { expanded: false, placement: "side" }), expect: { ...STAGE, side: PILL("recording", { marker: true }) } },
  { name: "side-open", side: true, state: recording(sayView([S_DEEPEN, S_HUBSPOT]), { placement: "side" }), expect: { ...STAGE, side: PILL("recording", { open: true, view: true, panel: "left", inside: true }) } },
  { name: "side-open-steps", side: true, state: recording(sayView([S_HUBSPOT]), { placement: "side" }), steps: [".say-bar .live-action:nth-child(3)"], expect: { ...STAGE, side: PILL("recording", { open: true, view: true, panel: "left", inside: true }), say: { peek: "steps" } } },
  // On the left edge it opens to the right; low on the screen the island slides up to stay whole.
  { name: "side-left-open", side: true, state: recording(sayView([S_HUBSPOT]), { placement: "side", pill: { edge: "left", at: 0.95 } }), expect: { ...STAGE, side: PILL("recording", { strip: { ...STRIP, edge: "left" }, open: true, view: true, panel: "right", inside: true }) } },
  // Lying on the top edge, and on the bottom one with the island above it.
  { name: "side-top-closed", side: true, state: recording(sayView([S_HUBSPOT]), { expanded: false, placement: "side", pill: { edge: "top", at: 0.5 } }), expect: { ...STAGE, side: PILL("recording", { strip: { width: 104, height: 40, edge: "top", gap: 12 }, marker: true }) } },
  { name: "side-bottom-open", side: true, state: recording(sayView([S_HUBSPOT]), { placement: "side", pill: { edge: "bottom", at: 0.2 } }), expect: { ...STAGE, side: PILL("recording", { strip: { width: 104, height: 40, edge: "bottom", gap: 12 }, open: true, view: true, panel: "above", inside: true }) } },
  // Not recording, it is still the pill: the notch's icon (the Vocify mark at rest, the caller's app on a detected call).
  { name: "side-idle", side: true, state: { ...recording(null, { placement: "side" }), mode: { kind: "idle" }, expanded: false }, expect: { ...STAGE, side: PILL("idle") } },
  { name: "side-idle-open", side: true, state: { ...recording(null, { placement: "side" }), mode: { kind: "idle" }, expanded: true }, expect: { ...STAGE, side: PILL("idle", { open: true, panel: "left", inside: true, glyph: true }) } },
  { name: "side-call", side: true, state: { ...recording(null, { placement: "side" }), mode: { kind: "call", caller: { name: "Zoom", appId: "us.zoom.xos", holding: true, icon: null } }, expanded: false }, expect: { ...STAGE, side: PILL("call", { action: "record-dot" }) } },
);

// Dragging the pill (window 1000 x 720, from where the fixture rests): where it rests after it is let go, and what the page
// tells the app (the spot to remember). The click that ends a drag neither opens nor closes the island.
export const pillDrags = [
  { name: "pill-to-top", fixture: "side-idle", to: { x: 400, y: 30 }, expect: { strip: { width: 104, height: 40, edge: "top", gap: 12 }, open: false, drop: { edge: "top", at: 0.4 } } },
  { name: "pill-to-left-low", fixture: "side-idle", to: { x: 25, y: 690 }, expect: { strip: { width: 40, height: 104, edge: "left", gap: 12 }, open: false, drop: { edge: "left", at: 0.928 } } },
  { name: "pill-to-bottom", fixture: "side-closed", to: { x: 700, y: 712 }, expect: { strip: { width: 104, height: 40, edge: "bottom", gap: 12 }, open: false, drop: { edge: "bottom", at: 0.7 } } },
  // Let go in the middle of the screen, it still goes to the nearest edge.
  { name: "pill-from-the-middle", fixture: "side-idle", to: { x: 820, y: 360 }, expect: { strip: { width: 40, height: 104, edge: "right", gap: 12 }, open: false, drop: { edge: "right", at: 0.5 } } },
];

export const sayInteractions = [
  { name: "say-respond-points-at-fresh", fixture: "say-fresh", click: ".say-bar .live-action:nth-child(1)", expect: [{ name: "liveAsk", ask: "respond" }] },
  { name: "say-respond-rewrites", fixture: "say-answer", click: ".say-bar .live-action:nth-child(1)", expect: [{ name: "liveRewrite", id: "hubspot", version: 1 }] },
  { name: "say-respond-asks", fixture: "say-empty", click: ".say-bar .live-action:nth-child(1)", expect: [{ name: "liveAsk", ask: "respond" }] },
  { name: "say-recap-asks", fixture: "say-empty", click: ".say-bar .live-action:nth-child(2)", expect: [{ name: "liveAsk", ask: "recap" }] },
  { name: "say-steps-opens", fixture: "say-empty", click: ".say-bar .live-action:nth-child(3)", expect: [{ name: "liveEvent", event: "open_steps" }] },
  { name: "say-step-asks", fixture: "say-empty", before: [".say-bar .live-action:nth-child(3)"], click: ".say-step-ask", expect: [{ name: "liveAskStep", kind: "step", id: "plantear_el_problema" }] },
  { name: "say-step-tick", fixture: "say-empty", before: [".say-bar .live-action:nth-child(3)"], click: ".say-step[data-done=\"false\"] .live-node", expect: [{ name: "liveTick", kind: "step", id: "plantear_el_problema", on: true }] },
  { name: "say-brief-opens", fixture: "say-empty", click: ".say-contact", expect: [{ name: "liveEvent", event: "open_brief" }] },
  { name: "say-bubble-asks", fixture: "say-empty", click: ".bubble[data-tappable=\"true\"]", expect: [{ name: "liveRespondTurn", turnId: "t2" }] },
  { name: "say-bubble-with-card-points", fixture: "say-answer", click: ".bubble[data-source=\"true\"]", expect: [] },
  { name: "say-done", fixture: "say-answer", click: ".say-done", expect: [{ name: "liveDismiss", id: "hubspot" }] },
  { name: "side-strip-opens", fixture: "side-closed", click: ".side-strip", expect: [{ name: "toggle" }] },
  { name: "side-strip-closes", fixture: "side-open", click: ".side-strip", expect: [{ name: "toggle" }] },
  { name: "side-idle-opens", fixture: "side-idle", click: ".side-strip", expect: [{ name: "toggle" }] },
  // The pill's own quick action is that action, not a toggle.
  { name: "side-call-records", fixture: "side-call", click: ".side-strip .pill-action button", expect: [{ name: "record" }] },
];
