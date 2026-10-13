import { execFileSync, spawn } from "node:child_process";
import { encodePowerShell, READER_LOOP_SCRIPT } from "../../windows/browser-pages.ts";
import { MIC_CONSENT_KEY } from "../../windows/mic-use.ts";
import { parsePhoneLinkCall, phoneLinkCallScript } from "../../windows/phone-link-call.ts";
import type { ReaderChild } from "../../windows/page-reader-process.ts";
import type { PlatformEnv } from "../env.ts";
import { every, runQuiet } from "../exec.ts";
import type { Platform } from "../types.ts";
import { createWindowsCallDetector } from "./call-detector.ts";
import { createWindowsCrmScreenReader } from "./crm-screen-reader.ts";
import { createWindowsPermissions } from "./permissions.ts";
import { createWindowsPhone } from "./phone.ts";
import { createWindowsSystemAudio } from "./system-audio.ts";

const reg = (args: string[]) => execFileSync("reg.exe", ["query", ...args], { encoding: "utf8", timeout: 5000, windowsHide: true });

/** The app the rep chose for TEL links (Settings › Default apps), as the UserChoice ProgId Windows keeps; null for none. */
function telProgId(): string | null {
  try {
    return /ProgId\s+REG_SZ\s+(\S+)/.exec(reg(["HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\tel\\UserChoice", "/v", "ProgId"]))?.[1] ?? null;
  } catch {
    return null;
  }
}

const hasDefaultTelApp = () => telProgId() !== null;

/** That app is Phone Link: its package (Microsoft.YourPhone), whatever the language shows as its name. */
function telAppIsPhoneLink(name: string): boolean {
  const progId = telProgId();
  if (!progId) return false;
  try {
    if (/Microsoft\.YourPhone/i.test(reg([`HKCR\\${progId}\\Application`, "/v", "AppUserModelID"]))) return true;
  } catch {
    // No package details for this ProgId: the name decides.
  }
  return /phone link|enlace m[oó]vil|yourphone/i.test(name);
}

/** Windows: Chromium's loopback, the microphone-use record in the registry, one long-lived PowerShell reader. */
export function createWindowsPlatform(env: PlatformEnv): Platform {
  return {
    // Naming the other side's speakers is Mac-only for now (Zoom Accessibility, Meet through the extension's Mac host).
    speakers: null,
    systemAudio: createWindowsSystemAudio(),
    callDetector: createWindowsCallDetector({
      read: () => runQuiet("reg.exe", ["query", MIC_CONSENT_KEY, "/s"], 5000),
      now: () => Date.now(),
      every,
      ownExePath: process.execPath,
      onError: (error) => env.log(`call detection read failed: ${String(error)}`),
      onActive: (apps) => env.log(`mic in use (Windows record): ${apps.length ? apps.join(", ") : "none"}`),
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
    phone: createWindowsPhone({
      // Only a default Windows keeps for TEL links counts: without one, Electron names Windows' own app picker
      // ("Choose an app", in the system's language) as if it were an app.
      telApp: () => (hasDefaultTelApp() ? env.protocolApp("tel:") : ""),
      openExternal: env.openExternal,
      openSoundRecording: () => void runQuiet("control.exe", ["mmsys.cpl,,1"], 10_000).catch((error) => env.log(`sound settings did not open: ${String(error)}`)),
      // Only Phone Link has a Call button Vocify knows; another app for TEL links is left to the rep.
      pressCall: (number) => {
        if (!telAppIsPhoneLink(env.protocolApp("tel:"))) return;
        void runQuiet("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(phoneLinkCallScript(number))], 20_000)
          .then((output) => env.log(`phone link call button: ${parsePhoneLinkCall(output)}`))
          .catch((error) => env.log(`phone link call button: failed (${String(error)})`));
      },
    }),
  };
}
