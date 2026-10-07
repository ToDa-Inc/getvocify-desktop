import { CrmPages } from "../../../../core/crmPages.ts";
import { createPageReaderProcess, type ReaderChild } from "../../windows/page-reader-process.ts";
import { WATCHED_BROWSERS } from "../../windows/browser-pages.ts";
import type { CrmScreenReader } from "../types.ts";

export function createWindowsCrmScreenReader(deps: {
  spawn(): ReaderChild;
  now(): number;
}): CrmScreenReader {
  const reader = createPageReaderProcess(deps.spawn, deps.now);

  return {
    async front(): Promise<string | null> {
      return reader.front();
    },
    isBrowser(app: string): boolean {
      return WATCHED_BROWSERS.has(app);
    },
    async read(app: string): Promise<string[] | null> {
      // Only read from browsers
      if (!WATCHED_BROWSERS.has(app)) return [];

      // Read the active tab of the window in front
      const page = await reader.frontPage();
      if (!page) return [];

      // Extract CRM URLs
      return CrmPages.frontRecordURLs(page.url);
    },
  };
}
