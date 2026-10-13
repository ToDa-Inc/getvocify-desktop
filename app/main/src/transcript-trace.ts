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

/**
 * Dev only: a recording's raw audio as the page had it, one file per side (`mic` as heard, `mic-sent` after the echo
 * filter, `call`), 16 kHz mono PCM16, plus an index of when each chunk arrived (page clock, ms) to line the sides up.
 */
export function createAudioTrace(userDataDir: string): (side: unknown, pcm: unknown, at: unknown, recording: unknown) => void {
  const dir = join(userDataDir, "traces");
  return (side, pcm, at, recording) => {
    if (typeof side !== "string" || !/^[a-z-]+$/.test(side) || !(pcm instanceof ArrayBuffer || ArrayBuffer.isView(pcm))) return;
    const bytes = pcm instanceof ArrayBuffer ? Buffer.from(pcm) : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const name = `audio-${new Date(typeof recording === "number" ? recording : 0).toISOString().replace(/[:.]/g, "-")}`;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${name}-${side}.pcm`), bytes);
      appendFileSync(join(dir, `${name}-index.jsonl`), `${JSON.stringify({ side, at, bytes: bytes.length })}\n`);
    } catch {
      // A trace that can't be written never gets in the way of the app.
    }
  };
}
