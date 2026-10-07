import { createMacPageReader, type Exec, type MacAccess } from "../../mac/browser-pages.ts";
import type { CrmScreenReader } from "../types.ts";

export function createMacCrmScreenReader(deps: {
  exec: Exec;
  access(): MacAccess | "authorized" | "denied" | "never_requested";
  onDenied?(): void;
}): CrmScreenReader {
  const reader = createMacPageReader(deps.exec);

  return {
    async front(): Promise<string | null> {
      return reader.front();
    },
    isBrowser(app: string): boolean {
      // Check if it's a supported browser AND access is authorized
      if (!reader.isBrowser(app)) return false;
      const accessStatus = deps.access();
      return accessStatus === "authorized";
    },
    async read(app: string): Promise<string[] | null> {
      // Only read from browsers with authorization
      if (!reader.isBrowser(app)) return [];

      const { urls, access } = await reader.read(app);

      if (access === "denied") {
        deps.onDenied?.();
      }

      return urls ?? [];
    },
  };
}
