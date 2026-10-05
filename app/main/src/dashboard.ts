import { app, BrowserWindow, session, shell, type WebContents } from "electron";

/**
 * The dashboard window. It is created when it is needed and given back when it is not: an Electron window costs about
 * 30 to 70 MB of renderer memory that a closed dashboard has no use for. While a call is recorded, or a call's update is
 * on the island, the page must stay alive (it records, and it writes the CRM update), so closing it then only hides it.
 */

export type DashboardOptions = {
  url: string;
  preload: string;
  /** Hosts whose pages may use the microphone and open inside the app. */
  isTrustedHost(host: string): boolean;
  /** Hosts that may open inside the app without being trusted with the microphone (a preview's sign-in). */
  isSignInHost?(host: string): boolean;
  /** Local file pages (the demo's stand-in dashboard) count as the app. */
  trustFiles: boolean;
  /** Whether the page may be destroyed now (nothing is recording and no call update is waiting). */
  canDestroy(): boolean;
  log(line: string): void;
};

const EXTERNAL = /^(https?:\/\/|mailto:)/i;

export class DashboardHost {
  private window: BrowserWindow | null = null;
  private ready = false;
  private queue: { channel: string; payload: unknown }[] = [];
  private readonly options: DashboardOptions;
  private permissionsSet = false;

  constructor(options: DashboardOptions) {
    this.options = options;
  }

  get contents(): WebContents | null {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null;
  }

  get exists(): boolean {
    return this.contents !== null;
  }

  get visible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  isFrom(contents: WebContents): boolean {
    return this.contents === contents;
  }

  private create(): BrowserWindow {
    this.setPermissions();
    const win = new BrowserWindow({
      width: 1200,
      height: 820,
      minWidth: 900,
      minHeight: 640,
      show: false,
      title: "Vocify",
      backgroundColor: "#f7f4ee",
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The page records and times the call: it must not be slowed down when hidden or behind the call.
        backgroundThrottling: false,
      },
    });
    this.window = win;
    this.ready = false;

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (EXTERNAL.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    // Anything that is not the app (HubSpot sign-in, docs, booking) opens in the browser, never inside the shell.
    win.webContents.on("will-navigate", (event, url) => {
      if (this.isAppUrl(url) || !EXTERNAL.test(url)) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
    win.webContents.on("console-message", (_event, level, message, line, source) => {
      if (level >= 3) this.options.log(`dashboard console error: ${message} (${source}:${line})`);
    });
    win.webContents.on("render-process-gone", (_event, details) => this.options.log(`dashboard renderer gone: ${details.reason}`));
    win.on("close", (event) => {
      if (this.options.canDestroy()) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      this.window = null;
      this.ready = false;
      this.queue = [];
    });
    void win.loadURL(this.options.url).catch((error: unknown) => this.options.log(`dashboard failed to load: ${String(error)}`));
    return win;
  }

  private isAppUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol === "file:") return this.options.trustFiles;
      return (url.protocol === "https:" || url.protocol === "http:") && (this.options.isTrustedHost(url.hostname) || this.options.isSignInHost?.(url.hostname) === true);
    } catch {
      return false;
    }
  }

  /** Only the app's own pages may use the microphone; everything else is refused. */
  private setPermissions(): void {
    if (this.permissionsSet) return;
    this.permissionsSet = true;
    const trusted = (origin: string) => {
      try {
        const url = new URL(origin);
        return url.protocol === "file:" ? this.options.trustFiles : this.options.isTrustedHost(url.hostname);
      } catch {
        return false;
      }
    };
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(permission === "media" && this.isFrom(contents) && trusted(details.requestingUrl));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => permission === "media" && contents !== null && this.isFrom(contents) && trusted(origin));
  }

  /** Brings the dashboard forward, creating it first if it was given back. */
  show(): void {
    const win = this.window && !this.window.isDestroyed() ? this.window : this.create();
    if (win.isMinimized()) win.restore();
    if (process.platform === "win32") {
      // Windows refuses to give focus to an app the user did not just click: a brief topmost flash gets it through.
      win.setAlwaysOnTop(true);
      win.show();
      win.setAlwaysOnTop(false);
    } else {
      win.show();
    }
    win.moveTop();
    win.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
  }

  /** Starts the page without showing it, for a call started from the island. */
  ensureHidden(): void {
    if (!this.exists) this.create();
  }

  /**
   * To the page (`__vocifyEmit`). Before the page is ready the message waits. Only what needs the page starts it: a
   * recording to begin, or a call's app and CRM page to name its contact. Everything else (a call ended, a pause) means
   * nothing to a page that is not there, and is dropped instead of paying for a window.
   */
  emit(channel: string, payload: unknown): void {
    const contents = this.contents;
    if (!contents) {
      const needsPage = (channel === "shell:command" && payload === "listen") || channel === "call:pages" || channel === "call:source";
      if (!needsPage) return;
      this.queue.push({ channel, payload });
      this.ensureHidden();
      return;
    }
    if (this.ready) contents.send("vocify:emit", channel, payload);
    else this.queue.push({ channel, payload });
  }

  /** The page has said something through the bridge, so its listeners exist: what waited can be delivered. */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    const contents = this.contents;
    if (!contents) return;
    for (const message of this.queue) contents.send("vocify:emit", message.channel, message.payload);
    this.queue = [];
  }

  /** Gives the page back once nothing needs it and nobody is looking at it. */
  releaseIfIdle(): void {
    if (this.window && !this.window.isDestroyed() && !this.window.isVisible() && this.options.canDestroy()) this.window.destroy();
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
