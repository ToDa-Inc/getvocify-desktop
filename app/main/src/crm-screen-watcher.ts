import { CrmScreenChange } from "../../core/callIsland.ts";

/**
 * Keeps the dashboard told which CRM record is in the frontmost browser (`crm:screen`), so the island can offer to call
 * it. Every 1.5 s it asks which app is in front and reads the pages only when it is a browser; another app in front
 * changes nothing (the last record stays). A read still running when the next tick comes is never stacked.
 * The Mac app's CrmScreenWatcher.swift does the same with AppleScript.
 */
export type CrmScreenDeps = {
  /** The frontmost app: Windows process name or Mac bundle id; null when unknown. */
  front(): Promise<string | null>;
  /** CRM URLs in that browser (`app`), frontmost window first; null when it cannot be read. */
  read(app: string): Promise<string[] | null>;
  isBrowser(app: string): boolean;
  emit(urls: string[]): void;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
};

export const CRM_SCREEN_EVERY_MS = 1500;

export function createCrmScreenWatcher(deps: CrmScreenDeps): { start(): void; stop(): void } {
  const change = new CrmScreenChange();
  let busy = false;
  let stopTimer: (() => void) | null = null;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const app = await deps.front();
      if (!app || !deps.isBrowser(app)) return;
      const urls = await deps.read(app);
      if (!Array.isArray(urls)) return;
      const next = change.next(urls);
      if (next) deps.emit(next);
    } catch {
      // A read that fails says nothing new.
    } finally {
      busy = false;
    }
  };

  return {
    start() {
      stopTimer ??= deps.every(CRM_SCREEN_EVERY_MS, () => void tick());
    },
    stop() {
      stopTimer?.();
      stopTimer = null;
    },
  };
}
