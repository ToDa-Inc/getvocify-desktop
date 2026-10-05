import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Meetings in progress or not yet sent, one JSON file each, so a quit, crash or failed upload never loses what was
 * transcribed. The dashboard owns the format. Port of MeetingDrafts.swift; ids are restricted so a draft can never
 * name a file outside its folder.
 */
export class Drafts {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(id: unknown): string | null {
    return typeof id === "string" && ID.test(id) ? join(this.dir, `${id}.json`) : null;
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
        drafts.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")));
      } catch {
        // A damaged draft is skipped, never fatal: the others are still recovered.
      }
    }
    return drafts;
  }

  remove(id: unknown): void {
    const file = this.file(id);
    if (file) rmSync(file, { force: true });
  }
}
