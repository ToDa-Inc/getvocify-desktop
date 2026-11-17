import { CaptureSessions, parseCaptureLine } from "../../windows/capture-sessions.ts";
import { MicWatcher } from "../../windows/mic-use.ts";
import type { AudioSessionReader, CallDetector, DetectedCaller } from "../types.ts";

/**
 * The apps holding the microphone, from two sources, polled every two seconds: Windows' microphone-use record (which
 * stops being written on some PCs) and the capture audio sessions, which the one long-lived reader reports on every change.
 */
export function createWindowsCallDetector(deps: {
  /** `reg query <MIC_CONSENT_KEY> /s`. */
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
  return {
    start(onChange: (caller: DetectedCaller | null) => void) {
      if (watcher) return;
      const captures = deps.captureReader ? new CaptureSessions() : null;
      let lastApps: string | null = null;
      deps.captureReader?.start((line) => {
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
      watcher = new MicWatcher({ ...deps, onCaller: onChange, captures: captures ? () => captures.uses() : undefined });
      watcher.start();
    },
    stop() {
      watcher?.halt();
      watcher = null;
      deps.captureReader?.stop();
    },
  };
}
