/**
 * Self-update from GitHub Releases. The installed app checks for a newer build and downloads it in the background. It
 * never restarts by itself: once the build is downloaded and nothing is in progress, the rep is asked (one native
 * notice, again for the same build only every few hours) and a click restarts into it. Otherwise the build installs on
 * the next quit. The rep can also restart into it at once (`install`).
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
  /** True when a restart would interrupt nothing (no recording, no call note being written or saved, the window closed). */
  canInstallNow(): boolean;
  /** For Restart now: true when only the rep's own wish is in the way (not recording, no call note being saved). */
  canRestartNow?(): boolean;
  /** Asks the rep to restart into a downloaded build; `restart` does it when they say yes. */
  notify?(version: string, restart: () => void): void;
  every(ms: number, fn: () => void): () => void;
  log(message: string): void;
  /** Called just before the app quits to install. */
  beforeInstall?(): void;
  /** Called on every change of state. */
  onState?(state: UpdateState): void;
  now?(): number;
  /** Runs `fn` once after `ms` (setTimeout by default). */
  after?(ms: number, fn: () => void): void;
};

/** How long a restart into an update may take before the app says it did not happen. */
export const RESTART_GIVE_UP_MS = 20_000;

/** What a failure to install says in Settings: the disk being full is said plainly. */
function installFailure(message: string): string | null {
  if (/no space left on device|ENOSPC/i.test(message)) return "Not enough free space on the disk to install the update. Free some space, then check again.";
  if (/ShipIt|ditto|Squirrel|code signature|could not be installed/i.test(message)) return `The update could not be installed: ${message}`;
  return null;
}

export const CHECK_EVERY_MS = 30 * 60_000;
/** How often a downloaded build is checked for a moment when nothing is in progress. */
const OFFER_EVERY_MS = 30_000;
/** The same build is offered again only after this long. */
export const OFFER_AGAIN_MS = 4 * 60 * 60_000;

export type Updater = {
  stop(): void;
  /** Asks now, outside the half-hourly rhythm. */
  check(): void;
  /** The rep asked to restart into the downloaded build: true when it restarts, false when nothing is ready or it must wait. */
  install(): boolean;
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
  let offered: { version: string; at: number } | null = null;
  let current: UpdateState = { state: "idle" };
  const set = (next: UpdateState) => {
    current = next;
    options.onState?.(next);
  };

  const after = options.after ?? ((ms: number, fn: () => void) => void setTimeout(fn, ms).unref?.());
  /** The downloaded build cannot be installed (the Mac could not unpack it): Settings says why, and Restart is no
   * longer offered for it. The next check downloads it, or a newer one, again. */
  const installFailed = (reason: string) => {
    downloaded = null;
    stopWaiting?.();
    stopWaiting = null;
    set({ state: "failed", reason, checkedAt: now() });
  };
  const restart = (): boolean => {
    if (downloaded === null || !(options.canRestartNow ?? options.canInstallNow)()) return false;
    const version = downloaded;
    log(`updating to ${version}`);
    options.beforeInstall?.();
    source.quitAndInstall(true, true);
    // A quit that never comes (macOS had no update ready to install, 2026-11-20: the disk was full) must not leave the
    // button waiting forever: still running a while later, the app says so.
    after(RESTART_GIVE_UP_MS, () => {
      if (downloaded !== version) return;
      log(`update: still running ${RESTART_GIVE_UP_MS / 1000} s after restarting into ${version}`);
      installFailed(`Vocify could not restart into ${version}. Quit Vocify and open it again to install it.`);
    });
    return true;
  };
  const offerWhenIdle = () => {
    if (downloaded === null || !options.canInstallNow()) return;
    if (offered?.version === downloaded && now() - offered.at < OFFER_AGAIN_MS) return;
    offered = { version: downloaded, at: now() };
    log(`update ${downloaded} offered`);
    options.notify?.(downloaded, () => void restart());
  };

  source.on("checking-for-update", () => {
    if (downloaded === null) set({ state: "checking" });
  });
  source.on("update-available", (info) => set({ state: "downloading", next: info.version }));
  source.on("update-not-available", () => set({ state: "current", checkedAt: now() }));
  source.on("update-downloaded", (info) => {
    // A newer build than the one already waiting replaces it: the rep is offered the newest.
    if (downloaded !== info.version) offered = null;
    downloaded = info.version;
    log(`update ${info.version} downloaded`);
    set({ state: "ready", next: info.version });
    offerWhenIdle();
    stopWaiting ??= options.every(OFFER_EVERY_MS, offerWhenIdle);
  });
  source.on("error", (error) => {
    log(`update check failed: ${error.message}`);
    const cannotInstall = installFailure(error.message);
    if (cannotInstall) return installFailed(cannotInstall);
    if (downloaded === null) set({ state: "failed", reason: error.message, checkedAt: now() });
  });

  // Checks go on after a build is downloaded: one published since is downloaded too, and offered instead (a rep was
  // offered 0.4.395 for an hour after 0.4.396 was out, 2026-11-20).
  const check = () => {
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
    install: restart,
    state: () => current,
    stop: () => {
      stopChecking();
      stopWaiting?.();
    },
  };
}
