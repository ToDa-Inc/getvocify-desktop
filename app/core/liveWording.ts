// Live call assistant wording: every word the island writes itself for the tabs, the bar, the peek, Ayuda and
// Conversación, in both languages. What the brain writes (what to say, their words, step names) comes from the dashboard
// and is in the call's language, whatever the island's.
import type { Language } from "./typeProposal.ts";

export type LiveOutcomeKey = "open" | "answered" | "promised" | "unanswered" | "gone" | "dismissed";

type Strings = {
  tabs: { transcript: string; help: string; conversation: string };
  /** The tab's tooltip when it carries a count. */
  tabCount: { help: (n: number) => string; conversation: (n: number) => string };
  respond: { label: string; help: string };
  ask: { label: string; help: string };
  recap: { label: string; help: string };
  waiting: (n: number) => string;
  missingLead: string;
  close: string;
  open: string;
  readingMinute: string;
  nothingFound: string;
  nothingPending: string;
  recapTitle: (at: string) => string;
  recapReading: string;
  recapEmpty: string;
  recapUnknown: (names: string[]) => string;
  reading: string;
  gap: string;
  sayMeanwhile: string;
  question: string;
  objection: string;
  /** An objection's type in words, when the playbook gave it no name of its own. */
  kinds: Record<string, string>;
  repeats: string;
  dismiss: { help: string; label: string };
  before: string;
  unanswered: (n: number) => string;
  outcome: Record<LiveOutcomeKey, string>;
  helpEmpty: string;
  helpOff: string;
  now: string;
  find: (label: string) => string;
  tick: string;
  untick: string;
  missing: string;
  done: string;
  markedByYou: string;
  whatToAsk: string;
  more: (n: number) => string;
  less: string;
  progress: (done: number, all: number) => string;
  noPlaybook: (name: string) => string;
  knowledgeOnly: string;
  goalHint: string;
  goal: string;
  reread: string;
  offlineTitle: string;
  offlineBody: (seconds: number) => string;
  views: string;
};

const ES: Strings = {
  tabs: { transcript: "Transcripción", help: "Ayuda", conversation: "Conversación" },
  tabCount: { help: (n) => `${n} por responder`, conversation: (n) => `${n} por hacer` },
  respond: { label: "Responder", help: "Responde a lo que ha dicho en el último minuto: una pregunta o una objeción" },
  ask: { label: "Preguntar", help: "Qué decir ahora para avanzar: lo que más pesa del playbook" },
  recap: { label: "Resumen", help: "Su situación, resumida hasta ahora" },
  waiting: (n) => (n === 1 ? "1 por responder" : `${n} por responder`),
  missingLead: "Falta",
  close: "Cerrar",
  open: "Abrir",
  readingMinute: "Leyendo el último minuto",
  nothingFound: "No encuentro una pregunta ni una objeción en el último minuto.",
  nothingPending: "No queda nada pendiente en el playbook.",
  recapTitle: (at) => `Resumen · hasta el ${at}`,
  recapReading: "Resumiendo",
  recapEmpty: "Aún no hay nada que resumir.",
  recapUnknown: (names) => `Aún no sabes: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : "."}`,
  reading: "Leyendo…",
  gap: "No está en tu conocimiento",
  sayMeanwhile: "Puedes decir esto mientras lo confirmas.",
  question: "Pregunta",
  objection: "Objeción",
  kinds: { price: "Precio", timing: "Momento", authority: "Quién decide", competitor: "Competidor", status_quo: "Ya tienen algo", trust: "Confianza", other: "Objeción" },
  repeats: "Lo repite",
  dismiss: { help: "No es una pregunta ni una objeción", label: "Descartar" },
  before: "Antes",
  unanswered: (n) => `${n} sin responder`,
  outcome: { open: "Abierto", answered: "Respondido", promised: "Prometido", unanswered: "Sin responder", gone: "Ya no aplica", dismissed: "Descartado" },
  helpEmpty: "Aquí aparecen las respuestas a sus preguntas y objeciones.",
  helpOff: "La ayuda en vivo está apagada en esta llamada.",
  now: "Ahora",
  find: (label) => `Averiguar · ${label}`,
  tick: "Marcar como hecho",
  untick: "Desmarcar",
  missing: "Falta",
  done: "Hecho",
  markedByYou: "Marcado por ti",
  whatToAsk: "Qué preguntar",
  more: (n) => `+${n} más`,
  less: "Ver menos",
  progress: (done, all) => `${done} de ${all}`,
  noPlaybook: (name) => `${name} no tiene playbook`,
  knowledgeOnly: "La ayuda solo usa tu conocimiento.",
  goalHint: "El objetivo de este tipo de llamada",
  goal: "Objetivo de la llamada",
  reread: "leído de nuevo para este tipo",
  offlineTitle: "Sin conexión con Vocify",
  offlineBody: (seconds) => `Lo que ves es de hace ${seconds} s. Reintentando.`,
  views: "Vistas de la llamada",
};

const EN: Strings = {
  tabs: { transcript: "Transcript", help: "Help", conversation: "Conversation" },
  tabCount: { help: (n) => `${n} to answer`, conversation: (n) => `${n} to do` },
  respond: { label: "Respond", help: "Answers what they said in the last minute: a question or an objection" },
  ask: { label: "Ask", help: "What to say now to move forward: what matters most in the playbook" },
  recap: { label: "Recap", help: "Their situation, summed up so far" },
  waiting: (n) => (n === 1 ? "1 to answer" : `${n} to answer`),
  missingLead: "Missing",
  close: "Close",
  open: "Open",
  readingMinute: "Reading the last minute",
  nothingFound: "I can't find a question or an objection in the last minute.",
  nothingPending: "Nothing is left to do in the playbook.",
  recapTitle: (at) => `Recap · up to ${at}`,
  recapReading: "Summing up",
  recapEmpty: "Nothing to sum up yet.",
  recapUnknown: (names) => `You don't know yet: ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : "."}`,
  reading: "Reading…",
  gap: "It's not in your knowledge",
  sayMeanwhile: "You can say this while you confirm it.",
  question: "Question",
  objection: "Objection",
  kinds: { price: "Price", timing: "Timing", authority: "Decision maker", competitor: "Competitor", status_quo: "Already have one", trust: "Trust", other: "Objection" },
  repeats: "Said again",
  dismiss: { help: "Not a question or an objection", label: "Dismiss" },
  before: "Earlier",
  unanswered: (n) => `${n} unanswered`,
  outcome: { open: "Open", answered: "Answered", promised: "Promised", unanswered: "Unanswered", gone: "No longer applies", dismissed: "Dismissed" },
  helpEmpty: "Answers to their questions and objections show up here.",
  helpOff: "Live help is off for this call.",
  now: "Now",
  find: (label) => `Find out · ${label}`,
  tick: "Mark as done",
  untick: "Unmark",
  missing: "Missing",
  done: "Done",
  markedByYou: "Marked by you",
  whatToAsk: "What to ask",
  more: (n) => `+${n} more`,
  less: "Show less",
  progress: (done, all) => `${done} of ${all}`,
  noPlaybook: (name) => `${name} has no playbook`,
  knowledgeOnly: "Help only uses your knowledge.",
  goalHint: "The goal of this kind of call",
  goal: "The call's goal",
  reread: "read again for this type",
  offlineTitle: "No connection to Vocify",
  offlineBody: (seconds) => `What you see is from ${seconds} s ago. Retrying.`,
  views: "Call views",
};

export const LiveWording = {
  strings(language: Language): Strings {
    return language === "es" ? ES : EN;
  },
};

export type LiveStrings = Strings;
