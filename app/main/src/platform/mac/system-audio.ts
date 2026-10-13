import type { SystemAudio } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/** 100 ms of mono 16 kHz signed 16-bit audio. */
const FRAME_BYTES = 3200;
/** The helper says `started` as soon as capture runs. ScreenCaptureKit's first start after launch can take several
 * seconds (it lists the displays first), so this only catches a helper that is stuck. */
const START_TIMEOUT_MS = 12000;
/** The microphone helper's first audio must come this soon; otherwise the page records its own microphone. */
const MIC_START_TIMEOUT_MS = 3000;

/**
 * The call's audio on a Mac: `vocify-mac-helper audio` (a Core Audio process tap, see native/mac-helper/PROTOCOL.md)
 * writes PCM on stdout and its status on stderr. One helper per capture; its stdout is cut into exact 3200-byte frames.
 * With the microphone, `vocify-mac-helper microphone` reads it in a process of its own, next to the call's (as anarlog
 * reads its mic next to its system-audio tap): read inside the call's helper it stopped the call's audio inside the app
 * (2026-10-14). The two run on different clocks; the server measures how late the mic hears the call and lines them up.
 */
export function createMacSystemAudio(deps: {
  spawn(command: "audio" | "microphone"): HelperChild;
  /** macOS allows Vocify the microphone. Without it the helper would read silence, so the page records its own (and asks). */
  micAllowed(): boolean;
  /** Test only: how long the microphone's first audio may take. */
  micStartTimeoutMs?: number;
  log?(line: string): void;
}): SystemAudio {
  const pcmListeners = new Set<(pcm: ArrayBuffer) => void>();
  const micListeners = new Set<(pcm: ArrayBuffer) => void>();
  const frames = (onFrame: (frame: Buffer) => void, size: number) => {
    let pending: Buffer = Buffer.alloc(0);
    return (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= size) {
        onFrame(pending.subarray(0, size));
        pending = pending.subarray(size);
      }
    };
  };
  const emitTo = (listeners: Set<(pcm: ArrayBuffer) => void>, frame: Buffer) => {
    const pcm = new Uint8Array(frame).buffer;
    for (const listener of listeners) listener(pcm);
  };
  const lostListeners = new Set<(reason: string) => void>();
  /** The running capture, or null. */
  let current: { helper: HelperChild; stopping: boolean } | null = null;
  /** The microphone's own helper while it runs. */
  let microphone: HelperChild | null = null;
  let starting = false;

  const capture = (helper: HelperChild) =>
    new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const session = { helper, stopping: false };
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

      const cut = frames((frame) => emitTo(pcmListeners, frame), FRAME_BYTES);
      helper.stdout.on("data", (chunk: Buffer) => {
        if (!started || session.stopping) return;
        cut(chunk);
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

  /** True once the microphone's helper delivers audio; a helper that does not (or cannot open it) is stopped. */
  function startMicrophone(): Promise<boolean> {
    const helper = deps.spawn("microphone");
    microphone = helper;
    const cut = frames((frame) => emitTo(micListeners, frame), FRAME_BYTES);
    return new Promise<boolean>((resolve) => {
      let heard = false;
      const timer = setTimeout(() => {
        if (heard) return;
        deps.log?.("microphone: no audio from the app's own mic, the page records its own");
        endMicrophone(helper);
        resolve(false);
      }, deps.micStartTimeoutMs ?? MIC_START_TIMEOUT_MS);
      helper.stdout.on("data", (chunk: Buffer) => {
        if (microphone !== helper) return;
        if (!heard) {
          heard = true;
          clearTimeout(timer);
          resolve(true);
        }
        cut(chunk);
      });
      helper.on("exit", () => {
        if (microphone === helper) microphone = null;
        if (!heard) {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
  }

  function endMicrophone(helper: HelperChild | null): void {
    if (!helper) return;
    if (microphone === helper) microphone = null;
    helper.stdin.end();
    setTimeout(() => helper.kill(), 1000).unref?.();
  }

  async function stop(): Promise<void> {
    endMicrophone(microphone);
    const session = current;
    if (!session) return;
    session.stopping = true;
    current = null;
    // Closing stdin is the helper's way to stop; a helper that ignores it is killed.
    session.helper.stdin.end();
    setTimeout(() => session.helper.kill(), 1000).unref?.();
  }

  return {
    async start(options) {
      if (current || starting) return { ok: false, reason: "already_running" };
      starting = true;
      try {
        const result = await capture(deps.spawn("audio"));
        if (!result.ok) return result;
        return { ...result, mic: options?.mic === true && deps.micAllowed() ? await startMicrophone() : false };
      } catch (error) {
        return { ok: false, reason: `helper_failed:${String(error)}` };
      } finally {
        starting = false;
      }
    },
    stop,
    onPcm(cb) {
      pcmListeners.add(cb);
      return () => void pcmListeners.delete(cb);
    },
    onLost(cb) {
      lostListeners.add(cb);
      return () => void lostListeners.delete(cb);
    },
    onMicPcm(cb) {
      micListeners.add(cb);
      return () => void micListeners.delete(cb);
    },
  };
}
