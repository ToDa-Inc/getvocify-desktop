import { CrmScreenChange } from "../../core/callIsland.ts";

/**
 * Keeps the dashboard told which CRM record is in the frontmost browser (`crm:screen`), so the island can offer to call
 * it. Every 1.5 s it asks which app is in front and reads the pages only when it is a browser; another app in front
 * changes nothing (the last record stays). A read still running when the next tick comes is never stacked. A browser
 * whose pages stay the same is read less often (see QUIET_READS).
 * The Mac app's CrmScreenWatcher.swift does the same with AppleScript.
 */
export type CrmScreenDeps = {
  /** The frontmost app: Windows process name or Mac bundle id; null when unknown. */
  front(): Promise<string | null>;
  /** CRM URLs in that browser (`app`), frontmost window first; null when it cannot be read. */
  read(app: string): Promise<string[] | null>;
  isBrowser(app: string): boolean;
  emit(urls: string[]): void;
  /** The OS refused Vocify this browser (the Mac's Automation); absent where it never does. */
  refused?(app: string): boolean;
  /** The browser in front Vocify may not read (its id), or null once a browser is read: the island says so, with Fix. */
  onBlocked?(app: string | null): void;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
};

export const CRM_SCREEN_EVERY_MS = 1500;
/** Reads in a row that showed the same pages, after which the browser is read less often (every 6 s, not every 1.5 s):
 * the pages change when the rep moves to another record, and a read walks every browser window (UI Automation). */
const QUIET_READS = 4;
const QUIET_SKIP_TICKS = 3;

export function createCrmScreenWatcher(deps: CrmScreenDeps): { start(): void; stop(): void } {
  const change = new CrmScreenChange();
  let busy = false;
  let lastApp: string | null = null;
  let quiet = 0;
  let skip = 0;
  let blocked: string | null = null;
  const block = (app: string | null) => {
    if (app === blocked) return;
    blocked = app;
    deps.onBlocked?.(app);
  };
  let stopTimer: (() => void) | null = null;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const app = await deps.front();
      // Another app in front, or another browser, starts the count again: its pages are read at once.
      if (app !== lastApp) {
        lastApp = app;
        quiet = 0;
        skip = 0;
      }
      if (!app || !deps.isBrowser(app)) return;
      if (skip > 0) {
        skip--;
        return;
      }
      const urls = await deps.read(app);
      if (deps.refused?.(app)) return block(app);
      if (!Array.isArray(urls)) return;
      block(null);
      const next = change.next(urls);
      if (next) {
        deps.emit(next);
        quiet = 0;
      } else {
        quiet++;
        skip = quiet < QUIET_READS ? 0 : QUIET_SKIP_TICKS;
      }
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
