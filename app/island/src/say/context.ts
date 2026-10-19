// What the Qué decir view's pieces share: the pushed view, the rep's own choices (UI-only: they never leave the island),
// and the words in the rep's language.
import { createContext, useContext } from "react";
import type { LiveStrings } from "../../../core/liveWording.ts";
import type { IslandAction, IslandState, LivePoint, LiveView } from "../types.ts";
import type { Marks } from "../live/model.ts";

/** What rises over the transcript on request: the recap, the steps, or who the contact is. One at a time. */
export type SayPeek = "recap" | "steps" | "brief" | null;

export type SayUi = {
  peek: SayPeek;
  /** Responder: reading the minute (or one tapped line) until the dashboard answers an ask newer than `after`; then, with
   * nothing to answer, the moment it said so (the next question shows for a while). */
  respond: { state: "reading"; after: number; from: "minute" | "turn" } | { state: "nothing"; at: number; from: "minute" | "turn" } | null;
  recap: { state: "reading"; after: number } | { state: "ready"; upTo: number | null; lines: string[]; unknown: string[] } | null;
  /** Responder pointed at a card: it pulses once. */
  flashId: string | null;
  flashAt: number | null;
  /** Cards the rep brought back with Responder, and cards the rep marked dealt with: shown at once, dropped once the
   * dashboard's state says the same. */
  reopened: string[];
  dismissed: string[];
  /** The rep's own ticks (true) and unticks (false), final over the brain's. */
  marks: Marks;
  /** Pasos: the pending item the rep tapped, its question under it until the dashboard answers an ask newer than `after`. */
  askStep: { kind: "step" | "data"; id: string; after: number; at: number } | null;
  /** "Otra forma" being written for a card: `had` versions when it was asked. */
  rewrite: { id: string; had: number; after: number; at: number } | null;
};

export const initialSayUi = (): SayUi => ({
  peek: null, respond: null, recap: null, flashId: null, flashAt: null, reopened: [], dismissed: [], marks: {}, askStep: null, rewrite: null,
});

/** A card as the rep sees it: the rep's ✓ and Responder's bringing back applied. */
export type SayPoint = LivePoint & { live: boolean };

export type SayContext = {
  state: IslandState;
  live: LiveView;
  words: LiveStrings;
  ui: SayUi;
  update: (patch: Partial<SayUi>) => void;
  act: (action: IslandAction) => void;
  points: SayPoint[];
  liveHelp: boolean;
  /** Reduced motion, or a pinned clock: nothing glides. */
  still: boolean;
  now: number;
};

export const Say = createContext<SayContext | null>(null);
export const useSay = (): SayContext => useContext(Say)!;
