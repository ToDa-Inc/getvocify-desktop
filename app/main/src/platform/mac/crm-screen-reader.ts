import { createMacPageReader, type Exec, type MacAccess } from "../../mac/browser-pages.ts";
import type { CrmScreenReader } from "../types.ts";

/**
 * The browsers through osascript (see mac/browser-pages.ts). Reading a browser is what makes macOS ask, so a browser is
 * only read once the rep allowed it; a refusal is reported so nothing is read again until it is allowed in Settings.
 */
export function createMacCrmScreenReader(deps: { exec: Exec; access(): MacAccess; onDenied?(): void }): CrmScreenReader {
  const reader = createMacPageReader(deps.exec);
  return {
    front: () => reader.front(),
    isBrowser: (app) => reader.isBrowser(app) && deps.access() === "authorized",
    async read(app) {
      const { urls, access } = await reader.read(app);
      if (access === "denied") deps.onDenied?.();
      return urls;
    },
  };
}
