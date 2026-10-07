import type { SystemAudio } from "../types.ts";
import type { HelperChild } from "./helper.ts";

const FRAME_SIZE = 3200; // 100 ms at 16 kHz, 2 bytes per sample: 16000 * 0.1 * 2

export function createMacSystemAudio(deps: { spawn: (command: "audio") => HelperChild }): SystemAudio {
  let running = false;
  let helper: HelperChild | null = null;
  let buffer = Buffer.alloc(0);
  let lostReported = false;
  const startTimeout = 5000; // 5 seconds
  let timeoutHandle: NodeJS.Timeout | null = null;

  const pcmCallbacks: Array<(pcm: ArrayBuffer) => void> = [];
  const lostCallbacks: Array<(reason: string) => void> = [];

  const cleanup = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (helper && !helper.killed) {
      helper.kill();
    }
    helper = null;
    running = false;
    buffer = Buffer.alloc(0);
    lostReported = false;
  };

  const handleData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Emit complete frames
    while (buffer.length >= FRAME_SIZE) {
      const frame = buffer.subarray(0, FRAME_SIZE);
      buffer = buffer.subarray(FRAME_SIZE);
      pcmCallbacks.forEach((cb) => cb(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)));
    }
  };

  const handleStderr = (chunk: Buffer) => {
    const text = chunk.toString();
    const lines = text.split("\n").filter((l) => l);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        if (event.event === "started") {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          timeoutHandle = null;
        } else if (event.event === "error") {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          timeoutHandle = null;
          running = false;
        } else if (event.event === "lost") {
          if (!lostReported) {
            lostReported = true;
            lostCallbacks.forEach((cb) => cb(event.reason || "unknown"));
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  };

  const handleExit = () => {
    if (running && !lostReported) {
      lostReported = true;
      lostCallbacks.forEach((cb) => cb("helper_exit"));
    }
    cleanup();
  };

  return {
    async start(): Promise<{ ok: boolean; reason?: string }> {
      if (running) {
        return { ok: false, reason: "already_running" };
      }

      lostReported = false;
      buffer = Buffer.alloc(0);

      helper = deps.spawn("audio");
      running = true;

      let started = false;
      let error: string | null = null;

      const result = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
        const onStderr = (chunk: Buffer) => {
          const text = chunk.toString();
          const lines = text.split("\n").filter((l) => l);

          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              if (event.event === "started") {
                started = true;
              } else if (event.event === "error") {
                error = event.reason || "unknown";
              }
            } catch {
              // Ignore
            }
          }
        };

        const onExit = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (started) {
            resolve({ ok: true });
          } else if (error) {
            resolve({ ok: false, reason: error });
          } else {
            resolve({ ok: false, reason: "helper_exit" });
          }
        };

        const onTimeout = () => {
          helper?.kill();
          resolve({ ok: false, reason: "helper_timeout" });
        };

        helper!.stderr.on("data", onStderr);
        helper!.on("exit", onExit);
        timeoutHandle = setTimeout(onTimeout, startTimeout);
      });

      if (!result.ok) {
        running = false;
        cleanup();
        return result;
      }

      // Start listening to stdout for audio frames
      helper!.stdout.on("data", handleData);
      helper!.stderr.on("data", handleStderr);
      helper!.on("exit", handleExit);

      return { ok: true };
    },

    async stop(): Promise<void> {
      if (helper && !helper.killed) {
        helper.stdin.end();
      }
      cleanup();
    },

    onPcm(cb: (pcm: ArrayBuffer) => void): () => void {
      pcmCallbacks.push(cb);
      return () => {
        const idx = pcmCallbacks.indexOf(cb);
        if (idx !== -1) pcmCallbacks.splice(idx, 1);
      };
    },

    onLost(cb: (reason: string) => void): () => void {
      lostCallbacks.push(cb);
      return () => {
        const idx = lostCallbacks.indexOf(cb);
        if (idx !== -1) lostCallbacks.splice(idx, 1);
      };
    },
  };
}
