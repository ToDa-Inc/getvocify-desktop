import type { PlatformEnv } from "../env.ts";
import { runStrict } from "../exec.ts";
import type { Platform } from "../types.ts";
import { createAudioAccess } from "./audio-access.ts";
import { createMacCallDetector } from "./call-detector.ts";
import { createMacCrmScreenReader } from "./crm-screen-reader.ts";
import { createMacIsland } from "./island.ts";
import { spawnMacHelper } from "./helper.ts";
import { createMacPermissions } from "./permissions.ts";
import { createMacSystemAudio } from "./system-audio.ts";

/**
 * macOS: osascript for the browsers; the call's audio, call detection and the notch through vocify-mac-helper
 * (native/mac-helper). Without the helper (a development build that has not built it) the Mac records the microphone
 * alone and detects no calls, as before.
 */
export function createMacPlatform(env: PlatformEnv): Platform {
  const helper = env.nativeHelperPath;
  if (!helper) throw new Error("The Mac platform needs the path to vocify-mac-helper");
  const access = createAudioAccess({
    spawn: (command) => spawnMacHelper(helper, command),
    capture: createMacSystemAudio({ spawn: (command) => spawnMacHelper(helper, command) }),
  });
  void access.refresh();
  return {
    systemAudio: access.systemAudio,
    callDetector: createMacCallDetector({ spawn: (command) => spawnMacHelper(helper, command), ownBundleId: "com.vocify.app" }),
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
      audioAccess: access,
    }),
    island: createMacIsland(env.nativePanelPath),
  };
}
