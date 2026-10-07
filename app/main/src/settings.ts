import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type SettingsStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
};

/**
 * Small settings kept in one JSON file. A write goes to a temporary file first, so a crash or a full disk never leaves
 * half a file behind; a missing or damaged file reads as "nothing set", never as an error.
 */
export class JsonSettings implements SettingsStore {
  private readonly file: string;
  private data: Record<string, unknown>;

  constructor(file: string) {
    this.file = file;
    this.data = this.read();
  }

  private read(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  get(key: string): unknown {
    return this.data[key];
  }

  set(key: string, value: unknown): void {
    this.data = { ...this.data, [key]: value };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.data));
      renameSync(temporary, this.file);
    } catch (error) {
      console.error("could not save settings:", error);
    }
  }
}
