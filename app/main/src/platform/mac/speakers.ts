import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SpeakerReader } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/** Chrome native messaging host the Vocify extension connects to (same name as the Swift app's). */
export const MEET_HOST = "com.vocify.speakers";
/** "Vocify - Voice to CRM" as installed from the Chrome Web Store. */
export const EXTENSION_IDS = ["eaneblbmmpgdchcejlfhiiklpcolfclb"];
/** Chrome reads user-level host manifests from `<profile root>/NativeMessagingHosts` (Chrome's native messaging docs). */
const BROWSER_ROOTS = ["Google/Chrome", "Chromium"];

/** The manifest that tells Chrome where the host is and which extension may use it. */
export function hostManifest(helperPath: string, extensionIds: string[]): string {
  return `${JSON.stringify(
    {
      name: MEET_HOST,
      description: "Vocify: who Google Meet shows speaking",
      path: helperPath,
      type: "stdio",
      allowed_origins: extensionIds.filter((id) => /^[a-p]{32}$/.test(id)).map((id) => `chrome-extension://${id}/`),
    },
    null,
    2,
  )}\n`;
}

/** Writes the manifest for each installed Chrome-family browser; rewritten when it differs (a moved app keeps working). */
export function installMeetHost(helperPath: string, home: string, log: (line: string) => void): void {
  const manifest = hostManifest(helperPath, EXTENSION_IDS);
  for (const root of BROWSER_ROOTS) {
    const browser = join(home, "Library/Application Support", root);
    if (!existsSync(browser)) continue;
    const folder = join(browser, "NativeMessagingHosts");
    const file = join(folder, `${MEET_HOST}.json`);
    try {
      if (existsSync(file) && readFileSync(file, "utf8") === manifest) continue;
      mkdirSync(folder, { recursive: true });
      writeFileSync(file, manifest);
    } catch (error) {
      log(`meet host manifest not written for ${root}: ${String(error)}`);
    }
  }
}

/** `vocify-mac-helper speakers`: Zoom through Accessibility, Meet through the extension (native/mac-helper/PROTOCOL.md). */
export function createMacSpeakerReader(deps: { spawn: (askAccessibility: boolean) => HelperChild }): SpeakerReader {
  let helper: HelperChild | null = null;
  return {
    start({ askAccessibility }, onSpeaking) {
      if (helper) return;
      const started = deps.spawn(askAccessibility);
      helper = started;
      started.stdout.on(
        "data",
        jsonLines((event) => {
          if (helper !== started || event.event !== "speaking" || !Array.isArray(event.names)) return;
          onSpeaking(event.names.filter((name): name is string => typeof name === "string"));
        }),
      );
      started.on("exit", () => {
        if (helper === started) helper = null;
      });
    },
    stop() {
      const stopping = helper;
      helper = null;
      stopping?.stdin.end();
      stopping?.kill();
    },
  };
}
