/**
 * Self-update from GitHub Releases. The installed app checks for a newer build, downloads it in the background and
 * installs it as soon as nothing is being recorded or reviewed; otherwise it waits (and installs on the next quit).
 */

/** The part of electron-updater's `autoUpdater` this file uses. */
export type UpdateSource = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null | undefined>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: { version: string }) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

/**
 * Where updating stands, as the dashboard's Settings shows it. `ready`: downloaded, the app restarts into it as soon
 * as nothing is being recorded. `unavailable`: this build never updates itself (run from source, the demo).
 */
export type UpdateState =
  | { state: "unavailable" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current"; checkedAt: number }
  | { state: "downloading"; next: string }
  | { state: "ready"; next: string }
  | { state: "failed"; reason: string; checkedAt: number };

/** The state plus this copy's own version. */
export type UpdateStatus = UpdateState & { version: string };

export type UpdaterOptions = {
  source: UpdateSource;
  /** True when nothing would be interrupted by a restart (no recording, no call update on screen). */
  canInstallNow(): boolean;
  every(ms: number, fn: () => void): () => void;
  log(message: string): void;
  /** Called just before the app quits to install. */
  beforeInstall?(): void;
  /** Called on every change of state. */
  onState?(state: UpdateState): void;
  now?(): number;
};

export const CHECK_EVERY_MS = 30 * 60_000;
const RETRY_INSTALL_MS = 30_000;

export type Updater = {
  stop(): void;
  /** Asks now, outside the half-hourly rhythm. */
  check(): void;
  state(): UpdateState;
};

export function startUpdater(options: UpdaterOptions): Updater {
  const { source, log } = options;
  const now = options.now ?? Date.now;
  source.autoDownload = true;
  source.autoInstallOnAppQuit = true;
  // Test builds are published as pre-releases; the updater picks the newest release of any kind.
  source.allowPrerelease = true;

  let downloaded: string | null = null;
  let stopWaiting: (() => void) | null = null;
  let current: UpdateState = { state: "idle" };
  const set = (next: UpdateState) => {
    current = next;
    options.onState?.(next);
  };

  const installWhenIdle = () => {
    if (downloaded === null) return;
    if (options.canInstallNow()) {
      log(`updating to ${downloaded}`);
      options.beforeInstall?.();
      source.quitAndInstall(true, true);
      return;
    }
    stopWaiting ??= options.every(RETRY_INSTALL_MS, installWhenIdle);
  };

  source.on("checking-for-update", () => {
    if (downloaded === null) set({ state: "checking" });
  });
  source.on("update-available", (info) => set({ state: "downloading", next: info.version }));
  source.on("update-not-available", () => set({ state: "current", checkedAt: now() }));
  source.on("update-downloaded", (info) => {
    downloaded = info.version;
    log(`update ${info.version} downloaded`);
    set({ state: "ready", next: info.version });
    installWhenIdle();
  });
  source.on("error", (error) => {
    log(`update check failed: ${error.message}`);
    if (downloaded === null) set({ state: "failed", reason: error.message, checkedAt: now() });
  });

  const check = () => {
    if (downloaded !== null) return;
    source
      .checkForUpdates()
      .then((result) => log(`checked: newest published build is ${result?.updateInfo?.version ?? "unknown"}`))
      .catch((error: unknown) => {
        log(`update check failed: ${String(error)}`);
        set({ state: "failed", reason: error instanceof Error ? error.message : String(error), checkedAt: now() });
      });
  };
  check();
  const stopChecking = options.every(CHECK_EVERY_MS, check);
  return {
    check,
    state: () => current,
    stop: () => {
      stopChecking();
      stopWaiting?.();
    },
  };
}
