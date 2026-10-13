import type { Status } from "./types.ts";

/** What every OS's platform gets from the app: Electron's few OS services, the rep's stored answer, the log. */
export type PlatformEnv = {
  systemPreferences: {
    getMediaAccessStatus(mediaType: "microphone"): string;
    askForMediaAccess(mediaType: "microphone"): Promise<boolean>;
  };
  openExternal(url: string): void;
  /** The name of the app that opens `scheme` links ("tel:"), or "" when none does (Electron's getApplicationNameForProtocol). */
  protocolApp(scheme: string): string;
  /** Whether call audio has been captured on this Mac once (its permission cannot be read on macOS 14.2+). */
  systemAudioStarted: { get(): boolean; set(): void };
  /** Where the rep's answer to "Vocify wants to control your browser" is kept (Mac). */
  crmTabsAnswer: { get(): Status | undefined; set(value: Status): void };
  log(line: string): void;
  /** This OS's native helper (the Mac's vocify-mac-helper); null where there is none. */
  nativeHelperPath: string | null;
  /** The Mac's in-process native module (native/mac-panel); null where there is none. */
  nativePanelPath: string | null;
  /** Dev only (VOCIFY_CAPTURE): capture the microphone natively on a Mac, "shared" or "apple" (SystemAudio.micMode). */
  nativeMic?: "shared" | "apple" | "all";
};
