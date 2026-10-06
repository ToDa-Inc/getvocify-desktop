import { CrmTabsAccess } from "../../../core/callIsland.ts";
import { CrmPages } from "../../../core/crmPages.ts";

/**
 * The CRM watcher's reads on a Mac, through `osascript` (the Mac app does the same with NSAppleScript). Reading a browser
 * makes macOS ask once ("Vocify wants to control Google Chrome"), so the watcher only reads after the rep allowed it from
 * first-run setup; a refusal (-1743) is remembered and nothing is read again until the rep allows it in Settings.
 */
export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>;

export type MacAccess = "authorized" | "denied" | "never_requested";

/** AppleScript's "not allowed to send Apple events" error. */
const NOT_ALLOWED = /-1743/;

export function createMacPageReader(exec: Exec) {
  return {
    /** The frontmost app's bundle id, or null. */
    async front(): Promise<string | null> {
      const out = await exec("/usr/bin/osascript", ["-e", "id of application (path to frontmost application as text)"], 3000).catch(() => "");
      return out.trim() || null;
    },

    isBrowser(bundleID: string): boolean {
      return CrmPages.browser(bundleID) !== undefined;
    },

    /**
     * First-run setup's "Allow": reads every running supported browser once, so macOS asks for each. Never launches one
     * (`is running` needs no consent). "unavailable" when none is open.
     */
    async askAll(): Promise<MacAccess | "unavailable"> {
      const answers: string[] = [];
      for (const id of CrmPages.bundleIDs()) {
        const running = await exec("/usr/bin/osascript", ["-e", `application id "${id}" is running`], 3000).catch(() => "false");
        if (running.trim() !== "true") continue;
        const { access } = await this.read(id);
        answers.push(access === "authorized" ? "granted" : access === "denied" ? "denied" : "not_asked");
      }
      const overall = CrmTabsAccess.aggregate(answers);
      return overall === "unavailable" ? "unavailable" : overall;
    },

    /** The CRM URLs of a supported browser's windows, front window first, and whether macOS let Vocify read it. */
    async read(bundleID: string): Promise<{ urls: string[] | null; access: MacAccess }> {
      const browser = CrmPages.browser(bundleID);
      if (!browser) return { urls: null, access: "never_requested" };
      try {
        const out = await exec("/usr/bin/osascript", ["-e", browser.script], 10_000);
        return { urls: CrmPages.crmURLs(out), access: "authorized" };
      } catch (error) {
        return { urls: null, access: NOT_ALLOWED.test(String((error as Error)?.message ?? error)) ? "denied" : "never_requested" };
      }
    },
  };
}
