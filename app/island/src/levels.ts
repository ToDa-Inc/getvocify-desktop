import type { Levels } from "./types.ts";

/**
 * Voice levels change about ten times a second. They go straight to the wave through this store instead of through
 * React state, so a level update never re-renders the island.
 */
let current: Levels = { you: 0, them: 0, side: "them", at: 0 };
const listeners = new Set<(levels: Levels) => void>();

export const levelsStore = {
  get(): Levels {
    return current;
  },
  set(levels: Levels): void {
    current = levels;
    for (const listener of listeners) listener(levels);
  },
  subscribe(listener: (levels: Levels) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
