import type { Status, SystemAudio } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/**
 * What Vocify knows about call audio access on this Mac, sharpened by what each capture found. On macOS 14.2+ the
 * capture is a process tap (System Audio Recording), which no API can read: the helper answers `unknown`, and a
 * capture that has started once (remembered across launches) is what says it was asked. Before 14.2 it is
 * ScreenCaptureKit, read by the helper's check (which cannot tell a refusal from "never asked").
 * `systemAudio` is the capture wrapped so every start updates it.
 */
export function createAudioAccess(deps: {
  spawn(command: "audio-permission"): HelperChild;
  capture: SystemAudio;
  /** A call audio capture has started on this Mac at least once. */
  started: { get(): boolean; set(): void };
}) {
  let known: Status = deps.started.get() ? "authorized" : "never_requested";

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
          // A refusal found by a capture stays until the check says it is allowed again; `unknown` (a tap) says nothing.
          if (line.status === "authorized") known = "authorized";
          else if (line.status === "never_requested" && known === "authorized" && !deps.started.get()) known = "never_requested";
        }),
      );
      helper.on("exit", done);
    });

  const systemAudio: SystemAudio = {
    ...deps.capture,
    async start() {
      const result = await deps.capture.start();
      if (result.ok) {
        known = "authorized";
        if (!deps.started.get()) deps.started.set();
      } else if (result.reason === "permission_denied") known = "denied";
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
