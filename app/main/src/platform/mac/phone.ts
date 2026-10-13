import { dialableNumber } from "../phone-number.ts";
import type { PhoneDialer } from "../types.ts";

/**
 * FaceTime places a `tel:` call through the rep's iPhone ("Calls on Other Devices" on the iPhone, same Apple ID).
 * Opened by bundle id, not as the default `tel:` app: Zoom and others register for `tel:` too. macOS asks the rep to
 * confirm the call; that click is the OS's, not Vocify's.
 */
export function createMacPhone(deps: {
  /** `/usr/bin/open` with these arguments; rejects when it fails. */
  open(args: string[]): Promise<unknown>;
  hasFaceTime(): boolean;
}): PhoneDialer {
  return {
    app: () => (deps.hasFaceTime() ? "FaceTime" : null),
    async dial(raw) {
      if (!deps.hasFaceTime()) return { ok: false, reason: "no_dialer" };
      const number = dialableNumber(raw);
      if (!number) return { ok: false, reason: "invalid_number" };
      try {
        await deps.open(["-b", "com.apple.FaceTime", `tel:${number}`]);
        return { ok: true };
      } catch {
        return { ok: false, reason: "open_failed" };
      }
    },
  };
}
