import type { Loopback } from "./loopback/loopback.ts";

/**
 * A call on the rep's phone heard through what the PC plays (Windows: Phone Link plays the call through the PC), for
 * when no app shows the call on the mic. While the island waits for the call, everything the PC plays is listened to
 * (nothing is kept): a second of sound within two is the call starting (its ring, or the other side). The capture that
 * heard it is then handed to the recording still running, so the start is not cut by a restart.
 */

/** No sample above this (out of 32768) is digital silence: nothing playing. Same value as the dashboard's AudioHealth. */
export const SILENT_PEAK = 2;
/** Sound for this long in total within `WINDOW_MS` is a call, not a notification. */
const SOUND_MS = 1000;
const WINDOW_MS = 2000;

function peak(pcm: ArrayBuffer): number {
  const samples = new Int16Array(pcm);
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  return max;
}

export class CallSoundWatch {
  private readonly deps: { loopback: Pick<Loopback, "start" | "stop" | "onPcm">; now(): number; log(line: string): void };
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private heard = false;
  /** When each sounding frame arrived, and how long it was (ms). */
  private sound: { at: number; ms: number }[] = [];

  constructor(deps: CallSoundWatch["deps"]) {
    this.deps = deps;
  }

  /** Listens until the call is heard (`onSound`, once) or `stop`/`handOver`. */
  async start(onSound: () => void): Promise<void> {
    await this.stop();
    this.heard = false;
    this.sound = [];
    this.unsubscribe = this.deps.loopback.onPcm((pcm) => {
      if (this.heard || peak(pcm) <= SILENT_PEAK) return;
      const now = this.deps.now();
      // 16 kHz mono 16-bit: 32 bytes per ms.
      this.sound.push({ at: now, ms: pcm.byteLength / 32 });
      this.sound = this.sound.filter((s) => now - s.at < WINDOW_MS);
      if (this.sound.reduce((total, s) => total + s.ms, 0) >= SOUND_MS) {
        this.heard = true;
        this.deps.log("call sound: heard, the call on the phone started");
        onSound();
      }
    });
    const started = await this.deps.loopback.start();
    this.running = started.ok;
    if (!started.ok) {
      this.deps.log(`call sound: could not listen (${started.reason ?? "unknown"})`);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  /** The recording takes the capture as it is: true when it is running and heard the call. */
  handOver(): boolean {
    const take = this.running && this.heard;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (take) this.running = false;
    return take;
  }

  /** Stops listening, and the capture unless it was handed over. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.running) {
      this.running = false;
      await this.deps.loopback.stop();
    }
  }
}
