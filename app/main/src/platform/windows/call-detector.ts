import { MicWatcher } from "../../windows/mic-use.ts";
import type { CallDetector, DetectedCaller } from "../types.ts";

/** The microphone-use record Windows keeps (see windows/mic-use.ts), polled once a second. */
export function createWindowsCallDetector(deps: {
  /** `reg query <MIC_CONSENT_KEY> /s`. */
  read(): Promise<string>;
  now(): number;
  every(ms: number, fn: () => void): () => void;
  ownExePath: string | null;
  onError?(error: unknown): void;
}): CallDetector {
  let watcher: MicWatcher | null = null;
  return {
    start(onChange: (caller: DetectedCaller | null) => void) {
      if (watcher) return;
      watcher = new MicWatcher({ ...deps, onCaller: onChange });
      watcher.start();
    },
    stop() {
      watcher?.halt();
      watcher = null;
    },
  };
}
