// What the live assistant's pieces share: the pushed view, the rep's own choices (UI-only state: it never leaves the
// island), and the words in the rep's language.
import { createContext, useContext } from "react";
import type { LiveStrings } from "../../../core/liveWording.ts";
import type { IslandAction, IslandState, LiveTab, LiveView } from "../types.ts";
import type { Marks, ShownPoint } from "./model.ts";

/** What slides up over the open tab: a point of Ayuda, Conversación's "Ahora", the recap, or Responder's reading. It is a
 * window onto the same thing in its own tab, never a copy. One at a time. */
export type Peek = { kind: "point"; id: string } | { kind: "now" } | { kind: "recap" } | { kind: "respond" } | null;

/** A tap on Responder or Resumen: reading until the dashboard answers an ask newer than `after` (its `seq` when it was
 * tapped), then the answer it gave, kept here so the dashboard closing its own ask never takes it from the peek. */
export type RespondAsk = { state: "reading"; after: number } | { state: "found"; id: string } | { state: "nothing" } | null;
export type RecapAsk = { state: "reading"; after: number } | { state: "ready"; upTo: number | null; lines: string[]; unknown: string[] } | null;

export type LiveUi = {
  peek: Peek;
  respond: RespondAsk;
  recap: RecapAsk;
  earlierOpen: boolean;
  /** Conversación: what is done, folded until opened; and the rest of what is missing past the first few. */
  doneOpen: boolean;
  todoOpen: boolean;
  /** Responder found the point already on screen: it pulses once (the moment it was asked). */
  flashId: string | null;
  flashAt: number | null;
  /** Points the rep asked to have answered again after they had closed; points the rep closed with the X. Both are shown
   * at once and dropped when the dashboard's state says the same. */
  reopened: string[];
  dismissed: string[];
  /** An older open point the rep opened from its one line. */
  expandedId: string | null;
  /** The rep's own ticks (true) and unticks (false), final over the brain's, dropped when the dashboard says the same. */
  marks: Marks;
  /** Conversación: the one point opened to show what to ask for it. */
  askId: string | null;
};

export const initialUi = (): LiveUi => ({
  peek: null, respond: null, recap: null, earlierOpen: false, doneOpen: false, todoOpen: false,
  flashId: null, flashAt: null, reopened: [], dismissed: [], expandedId: null, marks: {}, askId: null,
});

export type LiveContext = {
  state: IslandState;
  live: LiveView;
  words: LiveStrings;
  ui: LiveUi;
  update: (patch: Partial<LiveUi>) => void;
  act: (action: IslandAction) => void;
  tab: LiveTab;
  /** The points as the rep sees them (their X, Responder's reopening, and the fold into Antes applied). */
  points: ShownPoint[];
  liveHelp: boolean;
  /** Reduced motion, or a pinned clock: nothing glides. */
  still: boolean;
  now: number;
};

export const Live = createContext<LiveContext | null>(null);
export const useLive = (): LiveContext => useContext(Live)!;
