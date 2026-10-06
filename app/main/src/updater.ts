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
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type UpdaterOptions = {
  source: UpdateSource;
  /** True when nothing would be interrupted by a restart (no recording, no call update on screen). */
  canInstallNow(): boolean;
  every(ms: number, fn: () => void): () => void;
  log(message: string): void;
};

export const CHECK_EVERY_MS = 30 * 60_000;
const RETRY_INSTALL_MS = 30_000;

export type Updater = { stop(): void; /** Asks now, outside the half-hourly rhythm. */ check(): void };

export function startUpdater(options: UpdaterOptions): Updater {
  const { source, log } = options;
  source.autoDownload = true;
  source.autoInstallOnAppQuit = true;
  // Test builds are published as pre-releases; the updater picks the newest release of any kind.
  source.allowPrerelease = true;

  let downloaded: string | null = null;
  let stopWaiting: (() => void) | null = null;

  const installWhenIdle = () => {
    if (downloaded === null) return;
    if (options.canInstallNow()) {
      log(`updating to ${downloaded}`);
      source.quitAndInstall(true, true);
      return;
    }
    stopWaiting ??= options.every(RETRY_INSTALL_MS, installWhenIdle);
  };

  source.on("update-downloaded", (info) => {
    downloaded = info.version;
    log(`update ${info.version} downloaded`);
    installWhenIdle();
  });
  source.on("error", (error) => log(`update check failed: ${error.message}`));

  const check = () => {
    if (downloaded !== null) return;
    source
      .checkForUpdates()
      .then((result) => log(`checked: newest published build is ${result?.updateInfo?.version ?? "unknown"}`))
      .catch((error: unknown) => log(`update check failed: ${String(error)}`));
  };
  check();
  const stopChecking = options.every(CHECK_EVERY_MS, check);
  return {
    check,
    stop: () => {
      stopChecking();
      stopWaiting?.();
    },
  };
}
