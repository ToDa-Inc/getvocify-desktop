import type { SystemAudio } from "../types.ts";

/**
 * Mac system audio capture is not yet implemented (Phase 2: native helper).
 * Until then, always refuse with unsupported_platform.
 */
export function createMacSystemAudio(): SystemAudio {
  return {
    async start(): Promise<{ ok: boolean; reason?: string }> {
      return { ok: false, reason: "unsupported_platform" };
    },

    async stop(): Promise<void> {
      // Nothing to stop
    },

    onPcm(_cb: (pcm: ArrayBuffer) => void): () => void {
      // Never called
      return () => {};
    },

    onLost(_cb: (reason: string) => void): () => void {
      // Never called
      return () => {};
    },
  };
}
