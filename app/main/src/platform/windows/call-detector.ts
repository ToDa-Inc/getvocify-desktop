import { CaptureSessions, parseCaptureLine, parseConsentLine } from "../../windows/capture-sessions.ts";
import { MicWatcher, type MicUse } from "../../windows/mic-use.ts";
import type { AudioSessionReader, CallDetector, DetectedCaller } from "../types.ts";

/** The record the reader sent is trusted this long: it sends a line every ten seconds while it lives. */
const RECORD_FRESH_MS = 30_000;
/** How long the reader may take to send its first record before the registry is asked instead. On a slow PC it takes
 * tens of seconds to start, and the registry query launched meanwhile timed out every 2 s (an 8 GB PC, 2026-11-20). */
const READER_START_GRACE_MS = 45_000;
/** With the reader silent for good, the registry is asked this often, not at every 2 s look: the query launches a program
 * each time (21,000 a day on a rep's PC before the reader existed). */
const REGISTRY_EVERY_MS = 10_000;

/**
 * The apps holding the microphone, from two sources, read by one long-lived reader: Windows' microphone-use record (read
 * by the reader too, so no program is launched per look; `read`, the registry query, only while the reader is silent)
 * and the capture audio sessions. The reader reports on every change, and a change is looked at at once.
 */
export function createWindowsCallDetector(deps: {
  /** `reg query <MIC_CONSENT_KEY> /s`: the fallback while the reader does not report the record. */
  read(): Promise<string>;
  now(): number;
  every(ms: number, fn: () => void): () => void;
  ownExePath: string | null;
  onError?(error: unknown): void;
  onActive?(apps: string[]): void;
  /** The reader of the capture sessions (apps holding the microphone), when there is one. */
  captureReader?: AudioSessionReader;
  /** The apps holding the microphone through capture sessions, whenever that set changes. */
  onCaptureActive?(apps: string[]): void;
  /** A line from the capture reader that is not a report (an error the reader printed). */
  onCaptureError?(line: string): void;
}): CallDetector {
  let watcher: MicWatcher | null = null;
  /** The microphone-use record the reader last sent, and when. */
  let record: { uses: MicUse[]; at: number } | null = null;
  let recordError: string | null = null;
  let startedAt = 0;
  /** The last registry answer, kept for REGISTRY_EVERY_MS. */
  let registry: { at: number; text: Promise<string> } | null = null;
  let registrySaid = false;
  const readRegistry = (): Promise<string> => {
    const now = deps.now();
    if (registry && now - registry.at < REGISTRY_EVERY_MS) return registry.text;
    if (deps.captureReader && !registrySaid) {
      registrySaid = true;
      deps.onCaptureError?.("the reader sends no microphone record: asking the registry every 10 s instead");
    }
    registry = { at: now, text: deps.read() };
    return registry.text;
  };
  return {
    start(onChange: (caller: DetectedCaller | null) => void) {
      if (watcher) return;
      startedAt = deps.now();
      const captures = deps.captureReader ? new CaptureSessions() : null;
      let lastApps: string | null = null;
      deps.captureReader?.start((line) => {
        const uses = parseConsentLine(line);
        if (uses) {
          registrySaid = false;
          record = { uses, at: deps.now() };
          watcher?.refresh();
          return;
        }
        if (line.startsWith("CONSENT_ERROR")) {
          // The same error every ten seconds is one line in the log, not one each time.
          if (line !== recordError) {
            recordError = line;
            deps.onCaptureError?.(line);
          }
          return;
        }
        const sessions = parseCaptureLine(line);
        if (!sessions) {
          deps.onCaptureError?.(line);
          return;
        }
        captures?.update(sessions, deps.now());
        const apps = captures?.apps() ?? [];
        if (apps.join("\n") !== lastApps) {
          lastApps = apps.join("\n");
          deps.onCaptureActive?.(apps);
        }
      });
      watcher = new MicWatcher({
        ...deps,
        // With a reader, the registry is the last resort and asked rarely; without one it is the only source, as before.
        read: deps.captureReader ? readRegistry : deps.read,
        onCaller: onChange,
        captures: captures ? () => captures.uses() : undefined,
        record: deps.captureReader
          ? () => {
              const now = deps.now();
              if (record && now - record.at < RECORD_FRESH_MS) return record.uses;
              // Still starting: nothing is known yet, and no program is launched to find out. The capture sessions
              // (the same reader) say who holds the microphone as soon as it reports.
              if (!record && now - startedAt < READER_START_GRACE_MS) return [];
              return null;
            }
          : undefined,
      });
      watcher.start();
    },
    stop() {
      watcher?.halt();
      watcher = null;
      record = null;
      registry = null;
      registrySaid = false;
      deps.captureReader?.stop();
    },
  };
}
