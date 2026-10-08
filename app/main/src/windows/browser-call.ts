import type { CallSource } from "../../../core/callSource.ts";
import type { Caller } from "../controller.ts";

/**
 * A browser holding the microphone says nothing about a call: a page can hold it for its own reasons (a CRM's phone
 * widget on a contact page), and "Google Chrome call" helps nobody. So a browser is offered as a call only once its
 * pages say what the call is (Google Meet, Teams on the web, a web dialer), and it is then named by that: "Google Meet
 * call". The pages are looked at every few seconds while the browser holds the microphone, since the rep may join the
 * meeting after the browser started holding it.
 */
export type BrowserCallDeps = {
  /** What the browsers' pages show this to be; null when none is a call. */
  readSource(): Promise<CallSource | null>;
  /** The call to offer the island. */
  announce(caller: Caller): void;
  /** Repeats `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
};

const LOOK_EVERY_MS = 4000;

export function createBrowserCallWatch(deps: BrowserCallDeps) {
  let watching: { appId: string; stop: () => void } | null = null;

  const stopWatching = () => {
    watching?.stop();
    watching = null;
  };

  return {
    /** A browser holds the microphone (the same browser again changes nothing). */
    held(browser: { appId: string; icon: string | null }): void {
      if (watching?.appId === browser.appId) return;
      stopWatching();
      const watch = { appId: browser.appId, stop: () => {} };
      watching = watch;
      let looking = false;
      const look = async () => {
        if (looking || watching !== watch) return;
        looking = true;
        try {
          const source = await deps.readSource().catch(() => null);
          // The browser may have let go, or another one taken over, while the pages were read.
          if (watching !== watch || !source) return;
          // Offered once; the watch stays so the same browser is not looked at again, and ends when it lets go.
          watch.stop();
          deps.announce({ name: source.name, appId: browser.appId, icon: browser.icon });
        } finally {
          looking = false;
        }
      };
      watch.stop = deps.every(LOOK_EVERY_MS, () => void look());
      void look();
    },

    /** No browser holds the microphone any more, or something else is the call. */
    released(): void {
      stopWatching();
    },
  };
}
