// What the Qué decir view must remember while the island is closed (the open view unmounts when it closes): which
// version of each card the rep is reading, and which cards they have already seen. Kept per call, so a new call starts
// clean. Plain module state: the island page has one recording at a time.
import type { IslandState, LiveView } from "../types.ts";

/** A card's version the rep moved to with Responder, and when it started being written (wall clock, ms). */
export type Pick = { index: number; at: number };

let callKey: number | null = null;
const picks = new Map<string, Pick>();
const seen = new Set<string>();

/** Starts over when the call changes (its clock started at another moment). */
function forCall(state: IslandState): void {
  const key = state.clock?.startedAt ?? null;
  if (key === callKey) return;
  callKey = key;
  picks.clear();
  seen.clear();
}

export function pickOf(state: IslandState, id: string): Pick | null {
  forCall(state);
  return picks.get(id) ?? null;
}

export function setPick(state: IslandState, id: string, index: number, at: number): void {
  forCall(state);
  picks.set(id, { index, at });
}

/** The cards still open: what can be new to the rep. */
export function openIds(live: LiveView, liveHelp: boolean): string[] {
  if (!liveHelp || !live.on) return [];
  return live.points.filter((point) => !point.draft && point.outcome === "open").map((point) => point.id);
}

/** Everything open while the rep looks at the view counts as seen. */
export function markSeen(state: IslandState, ids: string[]): void {
  forCall(state);
  for (const id of ids) seen.add(id);
}

/** The newest open card the rep has not seen yet: the closed island's marker. Null: nothing new. */
export function unseen(state: IslandState, ids: string[]): string | null {
  forCall(state);
  const fresh = ids.filter((id) => !seen.has(id));
  return fresh.length ? fresh[fresh.length - 1] : null;
}
