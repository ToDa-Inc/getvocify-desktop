export type Status = "authorized" | "denied" | "never_requested";

/** Windows: Settings > Privacy & security > Microphone > "Let desktop apps access your microphone". */
export const MICROPHONE_SETTINGS_URL = "ms-settings:privacy-microphone";
const MAC_MICROPHONE_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
/** Where the Mac app's call audio is allowed (Screen & System Audio Recording). Windows has no such setting. */
export const MAC_SYSTEM_AUDIO_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

/** Where the microphone is switched on for this OS. */
export function microphoneSettingsUrl(platform: NodeJS.Platform): string {
  return platform === "darwin" ? MAC_MICROPHONE_SETTINGS_URL : MICROPHONE_SETTINGS_URL;
}

/**
 * Electron's `systemPreferences.getMediaAccessStatus('microphone')` as the dashboard's three states. On Windows 10 and
 * later it reflects the one global setting for all desktop apps (Electron's documentation); there is no per-app prompt.
 */
export function microphoneStatus(raw: string): Status {
  switch (raw) {
    case "granted":
      return "authorized";
    case "denied":
    case "restricted":
      return "denied";
    default:
      return "never_requested";
  }
}

/** The microphone state in a few words, for the tray menu. */
export function microphoneLabel(raw: string): string {
  switch (microphoneStatus(raw)) {
    case "authorized":
      return "allowed";
    case "denied":
      return "off";
    default:
      return "not asked yet";
  }
}

/**
 * What `permissions.status()` returns. Call audio needs no permission on Windows. Elsewhere this shell cannot capture it
 * (the Mac has its own native app), so it runs microphone-only: call audio is reported ready so the dashboard lets a
 * recording start, and no call audio ever arrives.
 */
export function permissionSnapshot(platform: NodeJS.Platform, microphoneRaw: string, reported?: "win32" | "darwin"): Record<string, unknown> {
  const windows = platform === "win32";
  return {
    platform: reported ?? (windows ? "win32" : "darwin"),
    microphone: microphoneStatus(microphoneRaw),
    systemAudio: "authorized",
  };
}

export const APP_INFO = { name: "Vocify", bundleId: "com.vocify.app" };
