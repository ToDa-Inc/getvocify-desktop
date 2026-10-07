import { spawn } from "node:child_process";
import { encodePowerShell, READER_LOOP_SCRIPT } from "../../windows/browser-pages.ts";
import { MIC_CONSENT_KEY } from "../../windows/mic-use.ts";
import type { ReaderChild } from "../../windows/page-reader-process.ts";
import type { PlatformEnv } from "../env.ts";
import { every, runQuiet } from "../exec.ts";
import type { Platform } from "../types.ts";
import { createWindowsCallDetector } from "./call-detector.ts";
import { createWindowsCrmScreenReader } from "./crm-screen-reader.ts";
import { createWindowsPermissions } from "./permissions.ts";
import { createWindowsSystemAudio } from "./system-audio.ts";

/** Windows: Chromium's loopback, the microphone-use record in the registry, one long-lived PowerShell reader. */
export function createWindowsPlatform(env: PlatformEnv): Platform {
  return {
    systemAudio: createWindowsSystemAudio(),
    callDetector: createWindowsCallDetector({
      read: () => runQuiet("reg.exe", ["query", MIC_CONSENT_KEY, "/s"], 5000),
      now: () => Date.now(),
      every,
      ownExePath: process.execPath,
      onError: (error) => env.log(`call detection read failed: ${String(error)}`),
    }),
    crmScreenReader: createWindowsCrmScreenReader({
      spawn: () =>
        spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(READER_LOOP_SCRIPT)], {
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
        }) as unknown as ReaderChild,
      now: () => Date.now(),
    }),
    permissions: createWindowsPermissions({
      microphoneAccess: () => env.systemPreferences.getMediaAccessStatus("microphone"),
      openExternal: env.openExternal,
    }),
    // A window that cannot take focus (focusable: false) is created WS_EX_NOACTIVATE: a click never activates the app.
    island: { prepare: () => "non-activating (Windows: not focusable)" },
  };
}
