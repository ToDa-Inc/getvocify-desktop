/**
 * The apps holding the microphone right now, read from Windows' capture audio sessions (the same Core Audio reader as the
 * render sessions, on capture endpoints): an app capturing from the mic has an active session there, whatever the
 * privacy record says. Windows' record stopped being written on some PCs, so this is a second source for call detection.
 * The reader prints `CAPTURE [{"pid":..,"app":"..","path":"..","id":".."}]` on every change (see audio-sessions.ts).
 */
import { parseTicks, useOf, type MicUse } from "./mic-use.ts";

export const CAPTURE_PREFIX = "CAPTURE ";
export const CONSENT_PREFIX = "CONSENT ";

/**
 * `CONSENT [...]` from the reader: the microphone-use record under the consent store, read in the reader (no program is
 * launched per look). Each item is a key below the microphone key with its times as text (see audio-sessions.ts). Null
 * for any other line, including a `CONSENT_ERROR`.
 */
export function parseConsentLine(line: string): MicUse[] | null {
  if (!line.startsWith(CONSENT_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(CONSENT_PREFIX.length));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  return parsed.flatMap((item): MicUse[] => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.k !== "string") return [];
    const use = useOf(entry.k, parseTicks(text(entry.s)), parseTicks(text(entry.e)));
    return use ? [use] : [];
  });
}

/** One capture session: the process holding the microphone, and the session instance (two sessions of one app are two). */
export type CaptureSession = { pid: number; app: string; path: string | null; id: string };

/** `CAPTURE [...]` from the reader: the sessions holding the microphone now; null for anything else (an ERROR line). */
export function parseCaptureLine(line: string): CaptureSession[] | null {
  if (!line.startsWith(CAPTURE_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(CAPTURE_PREFIX.length));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((item): CaptureSession[] => {
    if (typeof item !== "object" || item === null) return [];
    const session = item as Record<string, unknown>;
    const pid = Number(session.pid) || 0;
    const app = typeof session.app === "string" ? session.app : "";
    // pid 0 is the system's own sounds, and "?" is a process Windows would not name: neither is an app to report.
    if (pid === 0 || app === "" || app === "?") return [];
    const path = typeof session.path === "string" && session.path !== "" ? session.path : null;
    const id = typeof session.id === "string" ? session.id : "";
    return [{ pid, app, path, id }];
  });
}

/** The executable a session belongs to, as the registry names it (lowercase, with .exe). */
function exeOf(session: CaptureSession): string {
  if (session.path) return session.path.slice(session.path.lastIndexOf("\\") + 1).toLowerCase();
  return `${session.app.toLowerCase()}.exe`;
}

/**
 * The capture sessions seen by the reader, each with the time it was first seen: that is the start of its use of the
 * microphone, which call detection needs to skip a blip. A session that is gone is forgotten.
 */
export class CaptureSessions {
  private held = new Map<string, { session: CaptureSession; started: number }>();

  /** The sessions the reader reports now; `now` is when the report arrived. */
  update(sessions: CaptureSession[], now: number): void {
    const keys = new Set<string>();
    for (const session of sessions) {
      const key = `${session.pid}:${session.id}`;
      keys.add(key);
      if (!this.held.has(key)) this.held.set(key, { session, started: now });
    }
    for (const key of [...this.held.keys()]) if (!keys.has(key)) this.held.delete(key);
  }

  /** Every session holding the microphone, as a use of it (active, started when first seen). */
  uses(): MicUse[] {
    return [...this.held.values()].map(({ session, started }) => ({
      id: session.path ?? session.app,
      path: session.path,
      exe: exeOf(session),
      started,
      stopped: 0,
      active: true,
      source: "capture",
    }));
  }

  /** The executables holding the microphone, sorted and without repeats: for the log, when the set changes. */
  apps(): string[] {
    return [...new Set([...this.held.values()].map(({ session }) => exeOf(session)))].sort();
  }
}
