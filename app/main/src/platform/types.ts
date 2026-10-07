/**
 * What the shell needs from the operating system, one small interface per job. Each OS supplies its own
 * implementations (platform/windows, platform/mac) and `createPlatform` picks them, so the rest of the shell never
 * asks which OS it is on. Every implementation must pass the shared contract suites in main/test/contracts.
 */

export type Status = "authorized" | "denied" | "never_requested";

/** The call's audio (everything the computer plays), as mono 16 kHz signed 16-bit PCM in 3200-byte (100 ms) chunks. */
export interface SystemAudio {
  /** Starts capturing; says why not instead of throwing. */
  start(): Promise<{ ok: boolean; reason?: string }>;
  stop(): Promise<void>;
  onPcm(cb: (pcm: ArrayBuffer) => void): () => void;
  /** Capture ended on its own (device gone, renderer gone…). */
  onLost(cb: (reason: string) => void): () => void;
}

/** A desktop app holding the microphone, i.e. a call that may be worth recording. */
export type DetectedCaller = { name: string; appId: string; path: string | null; browser: boolean };

/** Which app started or stopped a call: reports a caller when one starts, null when it ends, and nothing in between. */
export interface CallDetector {
  start(onChange: (caller: DetectedCaller | null) => void): void;
  stop(): void;
}

/** The CRM record in the browser in front. */
export interface CrmScreenReader {
  /** The app in front (Windows process name, Mac bundle id), or null. */
  front(): Promise<string | null>;
  /** Whether `app` is a browser this OS can read (and, where the OS asks, the rep allowed it). */
  isBrowser(app: string): boolean;
  /** The CRM record URLs the browser's front tab shows ([] for none), or null when it could not be read. */
  read(app: string): Promise<string[] | null>;
}

export type PermissionKind = "microphone" | "systemAudio" | "crmTabs";

export type PermissionStatus = {
  platform: "win32" | "darwin";
  microphone: Status;
  systemAudio: Status;
  crmTabs: Status;
};

/** What the OS allows Vocify, and the way to ask for it. */
export interface Permissions {
  status(): PermissionStatus;
  /** Asks the OS (its prompt), or opens the OS settings page when it can no longer ask. Resolves once done. */
  request(kind: PermissionKind): Promise<void>;
  /** The OS settings page for `kind`, or null when this OS has none. */
  settingsUrl(kind: PermissionKind): string | null;
}

/** The island's own window, as the OS sees it. */
export type IslandWindow = { getNativeWindowHandle(): Buffer };

/** The island must never activate Vocify when it is clicked (that brings the dashboard forward and takes the keyboard). */
export interface IslandBehaviour {
  /** Makes the island window non-activating; says what it did, for the log. */
  prepare(window: IslandWindow): string;
}

/** One OS's implementations. `callDetector` is null on an OS that cannot detect calls yet. */
export type Platform = {
  systemAudio: SystemAudio;
  callDetector: CallDetector | null;
  crmScreenReader: CrmScreenReader;
  permissions: Permissions;
  island: IslandBehaviour;
};
