import { MICROPHONE_SETTINGS_URL, microphoneStatus } from "../../permissions.ts";
import type { Permissions } from "../types.ts";

/**
 * Windows asks nothing per app: the microphone is one global switch in Settings, call audio needs no permission, and the
 * address bars are read without asking.
 */
export function createWindowsPermissions(deps: { microphoneAccess(): string; openExternal(url: string): void }): Permissions {
  return {
    status: () => ({ platform: "win32", microphone: microphoneStatus(deps.microphoneAccess()), systemAudio: "authorized", crmTabs: "authorized" }),
    async request(kind) {
      if (kind === "microphone" && microphoneStatus(deps.microphoneAccess()) !== "authorized") deps.openExternal(MICROPHONE_SETTINGS_URL);
    },
    settingsUrl: (kind) => (kind === "microphone" ? MICROPHONE_SETTINGS_URL : null),
  };
}
