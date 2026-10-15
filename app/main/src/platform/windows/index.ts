import { execFileSync, spawn } from "node:child_process";
import { encodePowerShell, READER_LOOP_SCRIPT } from "../../windows/browser-pages.ts";
import { MIC_CONSENT_KEY } from "../../windows/mic-use.ts";
import { parsePhoneLinkCall, phoneLinkCallScript } from "../../windows/phone-link-call.ts";
import { AUDIO_SESSIONS_SCRIPT } from "../../windows/audio-sessions.ts";
import type { ReaderChild } from "../../windows/page-reader-process.ts";
import type { PlatformEnv } from "../env.ts";
import { every, runQuiet } from "../exec.ts";
import type { AudioSessionReader, Platform } from "../types.ts";
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

/**
 * Phone Link is installed (its package, Microsoft.YourPhone) even when the rep never made it the default for TEL links,
 * or Windows dropped that choice (an update, a reset). Asked of Windows' package list, so it takes a moment: the answer is
 * kept (longer when yes) instead of asking at every look.
 */
let phoneLinkSeen: { installed: boolean; at: number } | null = null;
function phoneLinkInstalled(): boolean {
  const now = Date.now();
  if (phoneLinkSeen && now - phoneLinkSeen.at < (phoneLinkSeen.installed ? 10 * 60_000 : 30_000)) return phoneLinkSeen.installed;
  let installed = false;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name Microsoft.YourPhone | Measure-Object).Count"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    installed = Number(out.trim()) > 0;
  } catch {
    installed = false;
  }
  phoneLinkSeen = { installed, at: now };
  return installed;
}

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

/** One PowerShell reading Core Audio's sessions while a call on the phone is followed; its output split into lines. */
function createAudioSessionReader(log: (line: string) => void): AudioSessionReader {
  let child: ReturnType<typeof spawn> | null = null;
  return {
    start(onLine) {
      if (child) return;
      const started = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(AUDIO_SESSIONS_SCRIPT)], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = started;
      let pending = "";
      started.stdout?.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onLine(line.trim());
      });
      started.stderr?.on("data", (chunk: Buffer) => {
        // PowerShell's own "#< CLIXML" header on its error stream is not an error.
        const text = chunk.toString("utf8").replace(/#< CLIXML/g, "").trim();
        if (text) log(`audio sessions: ${text.slice(0, 300)}`);
      });
      started.on("exit", (code) => {
        if (child === started) child = null;
        if (code) log(`audio sessions: reader exited ${code}`);
      });
    },
    stop() {
      const running = child;
      child = null;
      running?.kill();
    },
  };
}

/** Windows: Chromium's loopback, the microphone-use record in the registry, one long-lived PowerShell reader. */
export function createWindowsPlatform(env: PlatformEnv): Platform {
  /** The Phone Link Call press still waiting, if any. */
  let pressing: ReturnType<typeof spawn> | null = null;
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
    audioSessions: createAudioSessionReader(env.log),
    phone: createWindowsPhone({
      // Only a default Windows keeps for TEL links counts: without one, Electron names Windows' own app picker
      // ("Choose an app", in the system's language) as if it were an app.
      // With none chosen, an installed Phone Link still counts: the link opens Windows' own picker, where it is one click.
      telApp: () => (hasDefaultTelApp() ? env.protocolApp("tel:") : phoneLinkInstalled() ? "Phone Link" : ""),
      openExternal: env.openExternal,
      openSoundRecording: () => void runQuiet("control.exe", ["mmsys.cpl,,1"], 10_000).catch((error) => env.log(`sound settings did not open: ${String(error)}`)),
      // Only Phone Link has a Call button Vocify knows; another app for TEL links is left to the rep.
      pressCall: (number) => {
        if (!telAppIsPhoneLink(env.protocolApp("tel:"))) return;
        pressing?.kill();
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(phoneLinkCallScript(number))], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
        pressing = child;
        let output = "";
        child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
        child.on("exit", () => {
          if (pressing !== child) return env.log("phone link call button: stopped, the call had started");
          pressing = null;
          env.log(`phone link call button: ${parsePhoneLinkCall(output)}`);
        });
      },
      stopPressing: () => {
        const child = pressing;
        pressing = null;
        child?.kill();
      },
    }),
  };
}
