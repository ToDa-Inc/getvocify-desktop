import { CrmPages } from "../../../../core/crmPages.ts";
import { WATCHED_BROWSERS } from "../../windows/browser-pages.ts";
import { createPageReaderProcess, type ReaderChild } from "../../windows/page-reader-process.ts";
import type { CrmScreenReader } from "../types.ts";

/** The address bars, through one long-lived PowerShell (see windows/page-reader-process.ts). */
export function createWindowsCrmScreenReader(deps: { spawn(): ReaderChild; now(): number }): CrmScreenReader {
  const reader = createPageReaderProcess(deps.spawn, deps.now);
  return {
    front: () => reader.front(),
    isBrowser: (app) => WATCHED_BROWSERS.has(app),
    // The active tab of the window in front only, as the Chrome extension follows the focused tab.
    async read() {
      const page = await reader.frontPage();
      return page ? CrmPages.frontRecordURLs(page.url) : [];
    },
  };
}
