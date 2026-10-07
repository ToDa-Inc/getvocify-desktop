import type { PlatformEnv } from "../env.ts";
import { runStrict } from "../exec.ts";
import type { Platform } from "../types.ts";
import { createMacCrmScreenReader } from "./crm-screen-reader.ts";
import { createMacPermissions } from "./permissions.ts";
import { createMacSystemAudio } from "./system-audio.ts";

/** macOS: osascript for the browsers. Call audio and call detection come with the native helper; until then there are none. */
export function createMacPlatform(env: PlatformEnv): Platform {
  return {
    systemAudio: createMacSystemAudio(),
    callDetector: null,
    crmScreenReader: createMacCrmScreenReader({
      exec: runStrict,
      access: () => env.crmTabsAnswer.get() ?? "never_requested",
      onDenied: () => env.crmTabsAnswer.set("denied"),
    }),
    permissions: createMacPermissions({
      microphoneAccess: () => env.systemPreferences.getMediaAccessStatus("microphone"),
      askMicrophone: () => env.systemPreferences.askForMediaAccess("microphone"),
      openExternal: env.openExternal,
      exec: runStrict,
      crmTabs: env.crmTabsAnswer,
    }),
  };
}
