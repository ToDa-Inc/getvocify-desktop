import type { Status } from "./types.ts";

/** What every OS's platform gets from the app: Electron's few OS services, the rep's stored answer, the log. */
export type PlatformEnv = {
  systemPreferences: {
    getMediaAccessStatus(mediaType: "microphone"): string;
    askForMediaAccess(mediaType: "microphone"): Promise<boolean>;
  };
  openExternal(url: string): void;
  /** Where the rep's answer to "Vocify wants to control your browser" is kept (Mac). */
  crmTabsAnswer: { get(): Status | undefined; set(value: Status): void };
  log(line: string): void;
};
