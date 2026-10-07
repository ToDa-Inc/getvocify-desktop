import { MicWatcher, type DetectedCaller } from "../../windows/mic-use.ts";
import type { CallDetector } from "../types.ts";

export function createWindowsCallDetector(deps: {
  read(): Promise<string>;
  now(): number;
  every(ms: number, fn: () => void): () => void;
  ownExePath: string | null;
  onError?(): void;
}): CallDetector {
  const watcher = new MicWatcher({
    read: deps.read,
    now: deps.now,
    every: deps.every,
    ownExePath: deps.ownExePath,
    onCaller: (caller) => {
      onChangeCallback?.(caller);
    },
    onError: deps.onError,
  });

  let onChangeCallback: ((caller: DetectedCaller | null) => void) | null = null;

  return {
    start(onChange) {
      onChangeCallback = onChange;
      watcher.start();
    },
    stop() {
      onChangeCallback = null;
      watcher.halt();
    },
  };
}
