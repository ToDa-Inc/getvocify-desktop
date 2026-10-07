import type { PermissionKind, Permissions, PermissionStatus, Status } from "../types.ts";

export function createWindowsPermissions(deps: {
  microphoneAccess(): "granted" | "denied" | "restricted" | "not-determined";
  openExternal(url: string): void;
}): Permissions {
  const mapMicrophoneStatus = (raw: string): Status => {
    if (raw === "granted") return "authorized";
    if (raw === "denied" || raw === "restricted") return "denied";
    return "never_requested";
  };

  return {
    status(): PermissionStatus {
      return {
        platform: "win32",
        microphone: mapMicrophoneStatus(deps.microphoneAccess()),
        systemAudio: "authorized", // Windows can access system audio without asking
        crmTabs: "authorized", // Windows can read browser tabs without asking
      };
    },

    async request(kind: PermissionKind): Promise<void> {
      if (kind === "microphone") {
        const status = mapMicrophoneStatus(deps.microphoneAccess());
        if (status !== "authorized") {
          // Open Windows microphone settings (whether denied or never_requested)
          deps.openExternal("ms-settings:privacy-microphone");
        }
        // If "authorized", nothing to do
      }
      // systemAudio and crmTabs are always authorized, nothing to request
    },

    settingsUrl(kind: PermissionKind): string | null {
      if (kind === "microphone") {
        return "ms-settings:privacy-microphone";
      }
      // systemAudio and crmTabs have no settings page on Windows
      return null;
    },
  };
}
