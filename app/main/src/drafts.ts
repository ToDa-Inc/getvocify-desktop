import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ID = /^[A-Za-z0-9-]{1,64}$/;

type LogRecord = { from: number; segments: unknown[]; draft: Record<string, unknown> & { transcript?: Record<string, unknown> } };

/**
 * Meetings in progress or not yet sent, one JSON file each, so a quit, crash or failed upload never loses what was
 * transcribed. The dashboard owns the format. Port of MeetingDrafts.swift; ids are restricted so a draft can never
 * name a file outside its folder.
 *
 * Between whole saves the dashboard appends what changed to `<id>.log`, one JSON line each: the segments added from index
 * `from` on, and the rest of the draft. A save costs what is new, not the length of the call. A line is applied only where
 * it starts at the segments the draft already has, so a log a crash left behind is never applied twice; a whole save
 * drops the log, and a torn last line ends it.
 */
export class Drafts {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(id: unknown): string | null {
    return typeof id === "string" && ID.test(id) ? join(this.dir, `${id}.json`) : null;
  }

  private log(id: unknown): string | null {
    return typeof id === "string" && ID.test(id) ? join(this.dir, `${id}.log`) : null;
  }

  save(draft: unknown): boolean {
    if (typeof draft !== "object" || draft === null) return false;
    const file = this.file((draft as { id?: unknown }).id);
    if (!file) return false;
    try {
      mkdirSync(this.dir, { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify(draft));
      renameSync(temporary, file);
      rmSync(this.log((draft as { id?: unknown }).id) as string, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Adds what changed since the last save (`{ id, from, segments, draft }`, the draft without its segments). Refused
   * until the draft has been saved whole. */
  append(record: unknown): boolean {
    if (typeof record !== "object" || record === null) return false;
    const { id, from, segments, draft } = record as { id?: unknown; from?: unknown; segments?: unknown; draft?: unknown };
    const file = this.file(id);
    const log = this.log(id);
    if (!file || !log || !Number.isInteger(from) || (from as number) < 0 || !Array.isArray(segments)) return false;
    if (typeof draft !== "object" || draft === null || !existsSync(file)) return false;
    try {
      appendFileSync(log, `${JSON.stringify({ from, segments, draft })}\n`);
      return true;
    } catch {
      return false;
    }
  }

  list(): unknown[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const drafts: unknown[] = [];
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      try {
        const draft = JSON.parse(readFileSync(join(this.dir, name), "utf8"));
        drafts.push(this.withLog(name.slice(0, -".json".length), draft));
      } catch {
        // A damaged draft is skipped, never fatal: the others are still recovered.
      }
    }
    return drafts;
  }

  /** The draft with the lines its log added after its last whole save. */
  private withLog(id: string, draft: unknown): unknown {
    const log = this.log(id);
    let text = "";
    try {
      text = log ? readFileSync(log, "utf8") : "";
    } catch {
      return draft;
    }
    let current = draft as { transcript?: { segments?: unknown[] } } & Record<string, unknown>;
    for (const line of text.split("\n")) {
      if (!line) continue;
      let record: LogRecord;
      try {
        record = JSON.parse(line) as LogRecord;
      } catch {
        break;
      }
      const have = current.transcript?.segments;
      if (!Array.isArray(have) || !Array.isArray(record.segments) || typeof record.draft !== "object" || record.draft === null) break;
      if (record.from > have.length) break;
      if (record.from < have.length) continue;
      current = {
        ...current,
        ...record.draft,
        transcript: { ...record.draft.transcript, segments: [...have, ...record.segments] },
      };
    }
    return current;
  }

  /** Unsent meetings on disk. While any exist, the dashboard page that sends them must stay alive. */
  count(): number {
    try {
      return readdirSync(this.dir).filter((n) => n.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  remove(id: unknown): void {
    const file = this.file(id);
    if (!file) return;
    rmSync(file, { force: true });
    rmSync(this.log(id) as string, { force: true });
  }
}
