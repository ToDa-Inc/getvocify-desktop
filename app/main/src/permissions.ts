export type Status = "authorized" | "denied" | "never_requested";

/** Windows: Settings > Privacy & security > Microphone > "Let desktop apps access your microphone". */
export const MICROPHONE_SETTINGS_URL = "ms-settings:privacy-microphone";

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

/** What `permissions.status()` returns. Call audio needs no permission on Windows and cannot be captured elsewhere. */
export function permissionSnapshot(platform: NodeJS.Platform, microphoneRaw: string): Record<string, unknown> {
  const windows = platform === "win32";
  return {
    platform: windows ? "win32" : "darwin",
    microphone: microphoneStatus(microphoneRaw),
    systemAudio: windows ? "authorized" : "denied",
    ...(windows ? {} : { systemAudioError: "unsupported_platform" }),
  };
}

export const APP_INFO = { name: "Vocify", bundleId: "com.vocify.app" };
