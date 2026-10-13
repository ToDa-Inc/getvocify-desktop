import type { SystemAudio } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/** 100 ms of mono 16 kHz signed 16-bit audio. */
const FRAME_BYTES = 3200;
/** The helper says `started` as soon as capture runs. ScreenCaptureKit's first start after launch can take several
 * seconds (it lists the displays first), so this only catches a helper that is stuck. */
const START_TIMEOUT_MS = 12000;
/** With the microphone, the helper's first audio callback (`io`) must come this soon after `started`. Inside the app
 * macOS has started the device and then never run it (seen 2026-10-14 on a locally signed build): neither side
 * arrived. Without it the capture restarts without the microphone, so the call's audio is never what is lost. */
const MIC_IO_TIMEOUT_MS = 2000;

/**
 * The call's audio on a Mac: `vocify-mac-helper audio` (a Core Audio process tap, see native/mac-helper/PROTOCOL.md)
 * writes PCM on stdout and its status on stderr. One helper per capture; its stdout is cut into exact 3200-byte frames.
 * With the microphone (`audio --with-mic`) it reads both through one device on one clock and writes stereo, the
 * microphone left and the call right, sample for sample: the server measured the call's echo in it 21 ms early, the
 * whole call long, which is what lets it take the echo out.
 */
export function createMacSystemAudio(deps: {
  spawn(command: "audio", args?: string[]): HelperChild;
  /** macOS allows Vocify the microphone. Without it the helper would read silence, so the page records its own (and asks). */
  micAllowed(): boolean;
  /** Test only: how long the first audio callback may take with the microphone. */
  micIoTimeoutMs?: number;
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
  /** One stereo frame (left microphone, right call) into a mono frame for each. */
  const split = (frame: Buffer) => {
    const mic = Buffer.alloc(FRAME_BYTES);
    const call = Buffer.alloc(FRAME_BYTES);
    for (let i = 0; i < FRAME_BYTES / 2; i++) {
      mic.writeInt16LE(frame.readInt16LE(i * 4), i * 2);
      call.writeInt16LE(frame.readInt16LE(i * 4 + 2), i * 2);
    }
    emitTo(micListeners, mic);
    emitTo(pcmListeners, call);
  };
  const lostListeners = new Set<(reason: string) => void>();
  /** The running capture, or null. */
  let current: { helper: HelperChild; stopping: boolean } | null = null;
  let starting = false;

  const capture = (helper: HelperChild, withMic: boolean, onIo?: () => void) =>
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

      const cut = withMic ? frames(split, FRAME_BYTES * 2) : frames((frame) => emitTo(pcmListeners, frame), FRAME_BYTES);
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
          } else if (event.event === "io") {
            onIo?.();
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

  async function stop(): Promise<void> {
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
        if (options?.mic === true && deps.micAllowed()) {
          let heard: () => void = () => {};
          const io = new Promise<boolean>((resolve) => {
            heard = () => resolve(true);
            setTimeout(() => resolve(false), deps.micIoTimeoutMs ?? MIC_IO_TIMEOUT_MS);
          });
          const result = await capture(deps.spawn("audio", ["--with-mic"]), true, () => heard());
          if (!result.ok) return result;
          if (await io) return { ...result, mic: true };
          deps.log?.("call audio: no audio with the microphone, restarting without it");
          await stop();
        }
        const result = await capture(deps.spawn("audio"), false);
        return result.ok ? { ...result, mic: false } : result;
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
