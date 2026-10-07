import { createMacPageReader, type Exec, type MacAccess } from "../../mac/browser-pages.ts";
import type { PermissionKind, Permissions, PermissionStatus, Status } from "../types.ts";

const MAC_MICROPHONE_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const MAC_SYSTEM_AUDIO_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security";

export function createMacPermissions(deps: {
  microphoneAccess(): "granted" | "denied" | "restricted" | "not-determined";
  askMicrophone(): Promise<boolean>;
  openExternal(url: string): void;
  exec: Exec;
  crmTabs: { get(): Status | undefined; set(value: Status): void };
}): Permissions {
  const mapMicrophoneStatus = (raw: string): Status => {
    if (raw === "granted") return "authorized";
    if (raw === "denied" || raw === "restricted") return "denied";
    return "never_requested";
  };

  return {
    status(): PermissionStatus {
      const crmStatus = deps.crmTabs.get() ?? "never_requested";
      return {
        platform: "darwin",
        microphone: mapMicrophoneStatus(deps.microphoneAccess()),
        systemAudio: "authorized", // Mac doesn't capture system audio yet
        crmTabs: crmStatus as Status,
      };
    },

    async request(kind: PermissionKind): Promise<void> {
      if (kind === "microphone") {
        const status = mapMicrophoneStatus(deps.microphoneAccess());
        if (status === "never_requested") {
          // Ask the user to allow microphone
          await deps.askMicrophone();
        } else if (status === "denied") {
          // Open Mac microphone settings
          deps.openExternal(MAC_MICROPHONE_SETTINGS_URL);
        }
        // If "authorized", nothing to do
      } else if (kind === "crmTabs") {
        const current = deps.crmTabs.get();
        if (current !== "authorized" && current !== "denied") {
          // Never asked or not yet determined - ask now
          const reader = createMacPageReader(deps.exec);
          const result = await reader.askAll();
          if (result === "authorized") {
            deps.crmTabs.set("authorized");
          } else if (result === "denied") {
            deps.crmTabs.set("denied");
          }
          // If "unavailable", leave it as is
        }
      }
      // systemAudio is always authorized, nothing to request
    },

    settingsUrl(kind: PermissionKind): string | null {
      if (kind === "microphone") {
        return MAC_MICROPHONE_SETTINGS_URL;
      }
      if (kind === "systemAudio") {
        return MAC_SYSTEM_AUDIO_SETTINGS_URL;
      }
      // crmTabs has no settings page
      return null;
    },
  };
}
