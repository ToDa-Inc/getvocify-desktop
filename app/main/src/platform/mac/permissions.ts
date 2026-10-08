import { createMacPageReader, type Exec } from "../../mac/browser-pages.ts";
import { MAC_MICROPHONE_SETTINGS_URL, MAC_SYSTEM_AUDIO_SETTINGS_URL, microphoneStatus } from "../../permissions.ts";
import type { Permissions, Status } from "../types.ts";

/**
 * macOS asks once per permission, in its own prompt; after a refusal only System Settings can change it. Call audio
 * (Screen & System Audio Recording) is known through `audioAccess`: what the helper reads, and what a capture found.
 */
export function createMacPermissions(deps: {
  microphoneAccess(): string;
  askMicrophone(): Promise<boolean>;
  openExternal(url: string): void;
  exec: Exec;
  crmTabs: { get(): Status | undefined; set(value: Status): void };
  audioAccess: { status(): Status; ask(): Promise<void> };
}): Permissions {
  const microphone = () => microphoneStatus(deps.microphoneAccess());
  return {
    status: () => ({ platform: "darwin", microphone: microphone(), systemAudio: deps.audioAccess.status(), crmTabs: deps.crmTabs.get() ?? "never_requested" }),
    async request(kind) {
      if (kind === "microphone") {
        if (microphone() === "never_requested") await deps.askMicrophone();
        else if (microphone() === "denied") deps.openExternal(MAC_MICROPHONE_SETTINGS_URL);
      } else if (kind === "systemAudio") {
        // A known refusal can only be undone in System Settings; otherwise trying to capture is what makes macOS ask.
        if (deps.audioAccess.status() === "denied") deps.openExternal(MAC_SYSTEM_AUDIO_SETTINGS_URL);
        else if (deps.audioAccess.status() === "never_requested") await deps.audioAccess.ask();
      } else if (kind === "crmTabs") {
        // Asked every time: a rep who allowed it in System Settings after refusing gets it back on the next "Allow".
        const answer = await createMacPageReader(deps.exec).askAll();
        if (answer === "authorized" || answer === "denied") deps.crmTabs.set(answer);
      }
    },
    settingsUrl: (kind) => (kind === "microphone" ? MAC_MICROPHONE_SETTINGS_URL : kind === "systemAudio" ? MAC_SYSTEM_AUDIO_SETTINGS_URL : null),
  };
}
