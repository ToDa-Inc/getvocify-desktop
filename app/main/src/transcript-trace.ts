import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { IslandState } from "../../island/src/types.ts";

/**
 * Dev only: every change to the transcript the island is given, one JSON line each with the time it arrived, in
 * `traces/` next to the app's data. A real call's glitch can then be replayed through the island exactly as it
 * happened. Changes nothing the island shows; off in packaged apps unless VOCIFY_TRACE=1.
 */
export function createTranscriptTrace(userDataDir: string): (state: IslandState) => void {
  const dir = join(userDataDir, "traces");
  const file = join(dir, `transcript-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  let last: IslandState["turns"] | null = null;
  return (state) => {
    if (state.turns === last) return;
    last = state.turns;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, `${JSON.stringify({ t: Date.now(), mode: state.mode.kind, expanded: state.expanded, turns: state.turns })}\n`);
    } catch {
      // A trace that can't be written never gets in the way of the app.
    }
  };
}
