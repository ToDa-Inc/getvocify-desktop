import type { SystemAudio } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/** 100 ms of mono 16 kHz signed 16-bit audio. */
const FRAME_BYTES = 3200;
/** The helper says `started` as soon as the tap runs; longer means something is wrong. */
const START_TIMEOUT_MS = 5000;

/**
 * The call's audio on a Mac: `vocify-mac-helper audio` (a Core Audio process tap, see native/mac-helper/PROTOCOL.md)
 * writes PCM on stdout and its status on stderr. One helper per capture; its stdout is cut into exact 3200-byte frames.
 */
export function createMacSystemAudio(deps: { spawn(command: "audio"): HelperChild }): SystemAudio {
  const pcmListeners = new Set<(pcm: ArrayBuffer) => void>();
  const lostListeners = new Set<(reason: string) => void>();
  /** The running capture, or null. */
  let current: { helper: HelperChild; stopping: boolean } | null = null;
  let starting = false;

  const capture = (helper: HelperChild) =>
    new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const session = { helper, stopping: false };
      let pending: Buffer = Buffer.alloc(0);
      let started = false;
      let lostReason: string | null = null;
      let settled = false;
      const settle = (result: { ok: boolean; reason?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result.ok) current = session;
        resolve(result);
      };
      const timer = setTimeout(() => {
        settle({ ok: false, reason: "helper_timeout" });
        helper.kill();
      }, START_TIMEOUT_MS);

      helper.stdout.on("data", (chunk: Buffer) => {
        if (!started || session.stopping) return;
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= FRAME_BYTES) {
          const frame = new Uint8Array(pending.subarray(0, FRAME_BYTES)).buffer;
          pending = pending.subarray(FRAME_BYTES);
          for (const listener of pcmListeners) listener(frame);
        }
      });
      helper.stderr.on(
        "data",
        jsonLines((event) => {
          if (event.event === "started") {
            started = true;
            settle({ ok: true });
          } else if (event.event === "error") {
            settle({ ok: false, reason: typeof event.reason === "string" ? event.reason : "capture_failed" });
          } else if (event.event === "lost") {
            lostReason = typeof event.reason === "string" ? event.reason : "lost";
          }
        }),
      );
      helper.on("exit", (code) => {
        // 127: the helper is not installed (a development build without it): record the microphone alone, as before.
        settle({ ok: false, reason: lostReason ?? (code === 127 ? "unsupported_platform" : "helper_exited") });
        if (current !== session) return;
        current = null;
        // Ended on its own, not by stop(): said once.
        if (!session.stopping) for (const listener of lostListeners) listener(lostReason ?? "helper_exited");
      });
    });

  return {
    async start() {
      if (current || starting) return { ok: false, reason: "already_running" };
      starting = true;
      try {
        return await capture(deps.spawn("audio"));
      } catch (error) {
        return { ok: false, reason: `helper_failed:${String(error)}` };
      } finally {
        starting = false;
      }
    },
    async stop() {
      const session = current;
      if (!session) return;
      session.stopping = true;
      current = null;
      // Closing stdin is the helper's way to stop; a helper that ignores it is killed.
      session.helper.stdin.end();
      setTimeout(() => session.helper.kill(), 1000).unref?.();
    },
    onPcm(cb) {
      pcmListeners.add(cb);
      return () => void pcmListeners.delete(cb);
    },
    onLost(cb) {
      lostListeners.add(cb);
      return () => void lostListeners.delete(cb);
    },
  };
}
