import type { PlatformEnv } from "../env.ts";
import { runStrict } from "../exec.ts";
import type { Platform } from "../types.ts";
import { createMacCallDetector } from "./call-detector.ts";
import { createMacCrmScreenReader } from "./crm-screen-reader.ts";
import { spawnMacHelper } from "./helper.ts";
import { createMacPermissions } from "./permissions.ts";
import { createMacSystemAudio } from "./system-audio.ts";

/** macOS: osascript for the browsers. Call audio and call detection come with the native helper. */
export function createMacPlatform(env: PlatformEnv): Platform {
  const systemAudio = createMacSystemAudio({
    spawn: (command) => spawnMacHelper(command as "audio"),
  });

  let callDetector: ReturnType<typeof createMacCallDetector> | null = null;
  try {
    callDetector = createMacCallDetector({
      spawn: (command) => spawnMacHelper(command as "mic"),
      ownBundleId: "com.vocify.app",
    });
  } catch (error) {
    env.log(`Failed to initialize call detector: ${error instanceof Error ? error.message : String(error)}`);
    callDetector = null;
  }

  return {
    systemAudio,
    callDetector,
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
      spawn: (command) => spawnMacHelper(command as "audio-permission"),
    }),
  };
}
