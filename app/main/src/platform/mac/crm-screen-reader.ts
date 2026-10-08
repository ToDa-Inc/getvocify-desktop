import { createMacPageReader, type Exec, type MacAccess } from "../../mac/browser-pages.ts";
import type { CrmScreenReader } from "../types.ts";

/** A browser macOS refused is tried again after this long: once the rep answered, macOS never asks again, so retrying is
 * silent, and it is how allowing Vocify in System Settings later brings the call offer back without a relaunch. */
export const REFUSED_RETRY_MS = 10_000;

/**
 * The browsers through osascript (see mac/browser-pages.ts). Reading a browser is what makes macOS ask, so nothing is
 * read before the rep was asked once (first-run "Allow"). A refusal only stops that browser, and only until it is tried
 * again: one refused browser never turns off the others, and a refusal is never final.
 */
export function createMacCrmScreenReader(deps: {
  exec: Exec;
  access(): MacAccess;
  onDenied?(): void;
  onAllowed?(): void;
  now?(): number;
}): CrmScreenReader {
  const reader = createMacPageReader(deps.exec);
  const now = deps.now ?? (() => Date.now());
  const refusedUntil = new Map<string, number>();
  const refused = new Set<string>();
  return {
    front: () => reader.front(),
    isBrowser: (app) => reader.isBrowser(app) && deps.access() !== "never_requested",
    refused: (app) => refused.has(app),
    async read(app) {
      if ((refusedUntil.get(app) ?? 0) > now()) return null;
      const { urls, access } = await reader.read(app);
      if (access === "denied") {
        refusedUntil.set(app, now() + REFUSED_RETRY_MS);
        refused.add(app);
        deps.onDenied?.();
      } else if (urls !== null) {
        refusedUntil.delete(app);
        refused.delete(app);
        deps.onAllowed?.();
      }
      return urls;
    },
  };
}
