import type { HelperChild } from "./helper.ts";
import { createMacPageReader, type Exec } from "../../mac/browser-pages.ts";
import { MAC_MICROPHONE_SETTINGS_URL, MAC_SYSTEM_AUDIO_SETTINGS_URL, microphoneStatus } from "../../permissions.ts";
import type { Permissions, Status } from "../types.ts";

/**
 * macOS asks once per permission, in its own prompt; after a refusal only System Settings can change it.
 * System audio permission is read from the helper's audio-permission command (cached), and requesting it
 * starts the audio helper briefly to trigger the OS prompt when never requested.
 */
export function createMacPermissions(deps: {
  microphoneAccess(): string;
  askMicrophone(): Promise<boolean>;
  openExternal(url: string): void;
  exec: Exec;
  crmTabs: { get(): Status | undefined; set(value: Status): void };
  spawn: (command: "audio-permission" | "audio") => HelperChild;
}): Permissions {
  let cachedSystemAudioStatus: Status | null = null;

  const microphone = () => microphoneStatus(deps.microphoneAccess());

  const readSystemAudioStatus = async (): Promise<Status> => {
    try {
      const helper = deps.spawn("audio-permission");
      return await new Promise<Status>((resolve) => {
        const cleanup = () => {
          if (!helper.killed) helper.kill();
        };

        const onStdout = (chunk: Buffer) => {
          const text = chunk.toString().trim();
          try {
            const event = JSON.parse(text);
            if (event.status) {
              const status = event.status === "unknown" ? "never_requested" : (event.status as Status);
              cachedSystemAudioStatus = status;
              resolve(status);
              cleanup();
            }
          } catch {
            // Ignore malformed JSON
          }
        };

        const onExit = () => {
          resolve(cachedSystemAudioStatus ?? "never_requested");
        };

        helper.stdout.on("data", onStdout);
        helper.on("exit", onExit);

        // Timeout after 2 seconds
        setTimeout(() => {
          cleanup();
          resolve(cachedSystemAudioStatus ?? "never_requested");
        }, 2000);
      });
    } catch {
      return cachedSystemAudioStatus ?? "never_requested";
    }
  };

  return {
    status(): any {
      return {
        platform: "darwin",
        microphone: microphone(),
        systemAudio: cachedSystemAudioStatus ?? "never_requested",
        crmTabs: deps.crmTabs.get() ?? "never_requested",
      };
    },
    async request(kind) {
      if (kind === "microphone") {
        if (microphone() === "never_requested") await deps.askMicrophone();
        else if (microphone() === "denied") deps.openExternal(MAC_MICROPHONE_SETTINGS_URL);
      } else if (kind === "systemAudio") {
        const status = await readSystemAudioStatus();
        if (status === "denied") {
          deps.openExternal(MAC_SYSTEM_AUDIO_SETTINGS_URL);
        } else if (status === "never_requested") {
          // Start and stop audio briefly to trigger the OS prompt
          // This will cause macOS to ask for screen recording permission
          try {
            const helper = deps.spawn("audio");
            const startPromise = new Promise<void>((resolve) => {
              const onStderr = () => {
                // Audio started or errored, stop it after brief delay
                setTimeout(() => {
                  if (!helper.killed) helper.stdin.end();
                  resolve();
                }, 2000);
              };

              const onExit = () => {
                resolve();
              };

              helper.stderr.once("data", onStderr);
              helper.on("exit", onExit);

              // Timeout after 3 seconds just in case
              setTimeout(() => {
                if (!helper.killed) helper.kill();
                resolve();
              }, 3000);
            });

            await startPromise;
          } catch {
            // Ignore errors; the permission status will be checked on next call
          }
          // Re-read the permission status after the prompt
          cachedSystemAudioStatus = null;
          await readSystemAudioStatus();
        }
      } else if (kind === "crmTabs") {
        // Asked every time: a rep who allowed it in System Settings after refusing gets it back on the next "Allow".
        const answer = await createMacPageReader(deps.exec).askAll();
        if (answer === "authorized" || answer === "denied") deps.crmTabs.set(answer);
      }
    },
    settingsUrl: (kind) => (kind === "microphone" ? MAC_MICROPHONE_SETTINGS_URL : kind === "systemAudio" ? MAC_SYSTEM_AUDIO_SETTINGS_URL : null),
  };
}
