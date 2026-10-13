import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { IslandState, Turn } from "../../island/src/types.ts";

/** Files written in the background: a dev trace must never hold up the app it is measuring. */
function streams(dir: string) {
  const open = new Map<string, WriteStream>();
  return (file: string): WriteStream | null => {
    let stream = open.get(file);
    if (!stream) {
      try {
        mkdirSync(dir, { recursive: true });
        stream = createWriteStream(join(dir, file), { flags: "a" });
        // A trace that can't be written never gets in the way of the app.
        stream.on("error", () => {});
        open.set(file, stream);
      } catch {
        return null;
      }
    }
    return stream;
  };
}

/**
 * Dev only: the transcript the island is given, as it changes, in `traces/` next to the app's data: each line has the
 * time, the order of the turns, and only the turns that changed since the line before. A real call's glitch can then be
 * replayed through the island exactly as it happened. Off in packaged apps unless VOCIFY_TRACE=1.
 */
export function createTranscriptTrace(userDataDir: string): (state: IslandState) => void {
  const file = `transcript-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  const stream = streams(join(userDataDir, "traces"));
  let last: IslandState["turns"] | null = null;
  const seen = new Map<string, string>();
  return (state) => {
    if (state.turns === last) return;
    last = state.turns;
    const changed: Turn[] = [];
    for (const turn of state.turns) {
      const key = `${turn.you}|${turn.label}|${turn.text}|${turn.pending}`;
      if (seen.get(turn.id) !== key) {
        seen.set(turn.id, key);
        changed.push(turn);
      }
    }
    if (state.turns.length === 0) seen.clear();
    stream(file)?.write(`${JSON.stringify({ t: Date.now(), mode: state.mode.kind, ids: state.turns.map((turn) => turn.id), changed })}\n`);
  };
}

/**
 * Dev only: a recording's raw audio as the page had it, one file per side (`mic` as heard, `mic-sent` after the echo
 * filter, `call`, and the comparison microphones), 16 kHz mono PCM16, plus an index of when each chunk arrived (page
 * clock, ms) to line the sides up.
 */
export function createAudioTrace(userDataDir: string): (side: unknown, pcm: unknown, at: unknown, recording: unknown) => void {
  const stream = streams(join(userDataDir, "traces"));
  return (side, pcm, at, recording) => {
    if (typeof side !== "string" || !/^[a-z-]+$/.test(side) || !(pcm instanceof ArrayBuffer || ArrayBuffer.isView(pcm))) return;
    const bytes = pcm instanceof ArrayBuffer ? Buffer.from(pcm) : Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const name = `audio-${new Date(typeof recording === "number" ? recording : 0).toISOString().replace(/[:.]/g, "-")}`;
    stream(`${name}-${side}.pcm`)?.write(bytes);
    stream(`${name}-index.jsonl`)?.write(`${JSON.stringify({ side, at, bytes: bytes.length })}\n`);
  };
}
