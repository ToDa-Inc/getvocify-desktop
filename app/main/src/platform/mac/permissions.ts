import { createMacPageReader, type Exec } from "../../mac/browser-pages.ts";
import { MAC_MICROPHONE_SETTINGS_URL, MAC_SYSTEM_AUDIO_SETTINGS_URL, microphoneStatus } from "../../permissions.ts";
import type { Permissions, Status } from "../types.ts";

/**
 * macOS asks once per permission, in its own prompt; after a refusal only System Settings can change it. Call audio is
 * not captured on a Mac yet (it records the microphone only), so it reads as allowed and a recording can start.
 */
export function createMacPermissions(deps: {
  microphoneAccess(): string;
  askMicrophone(): Promise<boolean>;
  openExternal(url: string): void;
  exec: Exec;
  crmTabs: { get(): Status | undefined; set(value: Status): void };
}): Permissions {
  const microphone = () => microphoneStatus(deps.microphoneAccess());
  return {
    status: () => ({ platform: "darwin", microphone: microphone(), systemAudio: "authorized", crmTabs: deps.crmTabs.get() ?? "never_requested" }),
    async request(kind) {
      if (kind === "microphone") {
        if (microphone() === "never_requested") await deps.askMicrophone();
        else if (microphone() === "denied") deps.openExternal(MAC_MICROPHONE_SETTINGS_URL);
      } else if (kind === "crmTabs") {
        // Asked every time: a rep who allowed it in System Settings after refusing gets it back on the next "Allow".
        const answer = await createMacPageReader(deps.exec).askAll();
        if (answer === "authorized" || answer === "denied") deps.crmTabs.set(answer);
      }
    },
    settingsUrl: (kind) => (kind === "microphone" ? MAC_MICROPHONE_SETTINGS_URL : kind === "systemAudio" ? MAC_SYSTEM_AUDIO_SETTINGS_URL : null),
  };
}
