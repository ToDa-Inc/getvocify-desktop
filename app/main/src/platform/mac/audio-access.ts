import type { Status, SystemAudio } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/**
 * What Vocify knows about Screen & System Audio Recording on this Mac: the helper's read-only check
 * (`audio-permission`, which cannot tell a refusal from "never asked"), sharpened by what each capture found.
 * `systemAudio` is the capture wrapped so every start updates it.
 */
export function createAudioAccess(deps: { spawn(command: "audio-permission"): HelperChild; capture: SystemAudio }) {
  let known: Status = "never_requested";

  const read = () =>
    new Promise<void>((resolve) => {
      const helper = deps.spawn("audio-permission");
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        helper.kill();
        done();
      }, 3000);
      helper.stdout.on(
        "data",
        jsonLines((line) => {
          // A refusal found by a capture stays until the check says it is allowed again.
          if (line.status === "authorized") known = "authorized";
          else if (line.status === "never_requested" && known === "authorized") known = "never_requested";
        }),
      );
      helper.on("exit", done);
    });

  const systemAudio: SystemAudio = {
    ...deps.capture,
    async start() {
      const result = await deps.capture.start();
      if (result.ok) known = "authorized";
      else if (result.reason === "permission_denied") known = "denied";
      return result;
    },
  };

  return {
    systemAudio,
    /** Re-reads the check (at launch, and when the rep may have changed it in System Settings). */
    refresh: read,
    status: () => known,
    /** Starting a capture is what makes macOS ask; it is stopped again at once. */
    async ask() {
      const result = await systemAudio.start();
      if (result.ok) await deps.capture.stop();
      await read();
    },
  };
}
