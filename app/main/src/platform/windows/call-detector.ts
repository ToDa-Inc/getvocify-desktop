import { CaptureSessions, parseCaptureLine, parseConsentLine } from "../../windows/capture-sessions.ts";
import { MicWatcher, type MicUse } from "../../windows/mic-use.ts";
import type { AudioSessionReader, CallDetector, DetectedCaller } from "../types.ts";

/** The record the reader sent is trusted this long: it sends a line every ten seconds while it lives. */
const RECORD_FRESH_MS = 30_000;

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
  return {
    start(onChange: (caller: DetectedCaller | null) => void) {
      if (watcher) return;
      const captures = deps.captureReader ? new CaptureSessions() : null;
      let lastApps: string | null = null;
      deps.captureReader?.start((line) => {
        const uses = parseConsentLine(line);
        if (uses) {
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
        onCaller: onChange,
        captures: captures ? () => captures.uses() : undefined,
        record: deps.captureReader
          ? () => (record && deps.now() - record.at < RECORD_FRESH_MS ? record.uses : null)
          : undefined,
      });
      watcher.start();
    },
    stop() {
      watcher?.halt();
      watcher = null;
      record = null;
      deps.captureReader?.stop();
    },
  };
}
