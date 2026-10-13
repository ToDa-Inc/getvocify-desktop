import { dialableNumber } from "../phone-number.ts";
import type { PhoneDialer } from "../types.ts";

/** The app Windows opens phone links in: Phone Link once the rep makes it the default for TEL (Settings › Default apps). */
export function createWindowsPhone(deps: {
  /** The name of the app that opens `tel:` links, or "" when none does. */
  telApp(): string;
  openExternal(url: string): void;
  /** `control.exe mmsys.cpl,,1`: the Sound dialog on its Recording tab. */
  openSoundRecording(): void;
}): PhoneDialer {
  const app = () => deps.telApp().trim() || null;
  return {
    app,
    async setup() {
      deps.openExternal("ms-settings:defaultapps");
    },
    async micSettings() {
      deps.openSoundRecording();
    },
    async dial(raw) {
      if (!app()) return { ok: false, reason: "no_dialer" };
      const number = dialableNumber(raw);
      if (!number) return { ok: false, reason: "invalid_number" };
      deps.openExternal(`tel:${number}`);
      return { ok: true };
    },
  };
}
