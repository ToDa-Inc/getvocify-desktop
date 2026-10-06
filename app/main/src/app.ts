import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, systemPreferences, Tray } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { CallSource } from "../../core/callSource.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandSize } from "../../island/src/geometry.ts";
import type { Geometry, IslandAction, IslandState } from "../../island/src/types.ts";
import { createBridge } from "./bridge.ts";
import { signInHostsFor, type ReportedPlatform } from "./config.ts";
import { IslandController, type Caller } from "./controller.ts";
import { DashboardHost } from "./dashboard.ts";
import { Drafts } from "./drafts.ts";
import { createLoopback } from "./loopback/loopback.ts";
import { createLogger } from "./logger.ts";
import { JsonSettings } from "./settings.ts";
import { ShortcutManager } from "./shortcut.ts";
import { microphoneLabel, microphoneSettingsUrl } from "./permissions.ts";
import { trayItems } from "./tray-menu.ts";
import { callSourceForExe } from "./windows/call-sources.ts";
import { crmUrlsOf, createPageReader, encodePowerShell, type BrowserPage } from "./windows/browser-pages.ts";
import { MIC_CONSENT_KEY, MicWatcher, type DetectedCaller } from "./windows/mic-use.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The app's icon (the Vocify mark): the dock on a Mac, the taskbar and title bar and the tray on Windows. */
const appIconPath = join(here, "../../island/dist/icon.png");

export type AppOptions = {
  /** The page the dashboard window loads. */
  dashboardUrl: string;
  /** A local page standing in for the dashboard (the demo): its file URL counts as the app. */
  trustFiles?: boolean;
  userDataDir: string;
  /** Drops the island below the top edge, to run beside another island instead of on top of it. */
  islandOffsetY?: number;
  /** The demo's window of buttons that stand in for the platform's call detection. */
  controls?: boolean;
  /** The platform name the dashboard is told (default: the real one). */
  reportedPlatform?: ReportedPlatform;
  /** For trying the permission flow: microphone and call audio start "not asked" until the dashboard asks for them. */
  testPermissions?: boolean;
  /** How long the dashboard page is kept after its last activity before it may be given back (default 30 s). */
  releaseGraceMs?: number;
};

export type AppHandle = {
  controller: IslandController;
  dashboard: DashboardHost;
  island: BrowserWindow;
  /** Test hook: what the island window is sized to right now. */
  islandBounds(): { x: number; y: number; width: number; height: number };
  /** The platform helper's job, by hand: the app now holding the microphone. */
  detectCall(caller: Caller | null): void;
  /** Test hook: the icon of an app, as the island shows it (a small PNG data URL), or null. */
  iconFor(path: string): Promise<string | null>;
  /** Test hook: what the dashboard would be told about permissions. */
  permissions(): Promise<unknown>;
  /** True when a restart would interrupt nothing: no recording and no call update on screen. */
  canInstallUpdate(): boolean;
  /** True when this start is the restart after an automatic update. */
  startedAfterUpdate: boolean;
  /** Called just before an update restarts the app. */
  markUpdateRestart(): void;
  /** What "Check for updates" in the tray menu does (set by the updater, which starts after the app). */
  onCheckForUpdates(fn: () => void): void;
  /** Writes a line to the app's log file. */
  log(message: string): void;
  quit(): void;
};

type Placement = { geometry: Geometry; midX: number; originX: number; originY: number };

/** The notch comes from a Swift script for now; the Mac helper's `geometry.get` replaces it. Everywhere else the screen is measured from Electron. */
function measureMac(): Promise<Placement | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/swift", [join(here, "../native/screen.swift")], { timeout: 60000 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const raw = JSON.parse(stdout) as { width?: number; height?: number; originX?: number; originY?: number; menuBar?: number; notchWidth?: number; barHeight?: number; midX?: number };
        if (!raw.width || !raw.height) return resolve(null);
        resolve({
          geometry: { notchWidth: raw.notchWidth ?? 0, barHeight: raw.barHeight ?? Math.max(raw.menuBar ?? 0, 30), screenHeight: raw.height },
          midX: raw.midX ?? raw.width / 2,
          originX: raw.originX ?? 0,
          originY: raw.originY ?? 0,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

function measureElectron(): Placement {
  const display = screen.getPrimaryDisplay();
  const menuBar = display.workArea.y - display.bounds.y;
  return {
    geometry: { notchWidth: 0, barHeight: Math.max(menuBar, 30), screenHeight: display.bounds.height },
    midX: display.bounds.width / 2,
    originX: display.bounds.x,
    originY: display.bounds.y,
  };
}

/** Pages that may use the microphone and open inside the app: Vocify's own, this computer, and the dashboard that was configured. */
const trustedHostsFor = (dashboardUrl: string) => {
  let configured = "";
  try {
    configured = new URL(dashboardUrl).hostname.toLowerCase();
  } catch {
    // Not a URL: only the built-in hosts are trusted.
  }
  return (host: string): boolean => {
    const h = host.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "getvocify.com" || h.endsWith(".getvocify.com") || (configured !== "" && h === configured);
  };
};

export async function startApp(options: AppOptions): Promise<AppHandle> {
  const log = createLogger(join(options.userDataDir, "logs", "vocify.log"));
  const settings = new JsonSettings(join(options.userDataDir, "settings.json"));
  // An update restarts the app by itself: it must not throw the dashboard window up as if the rep had just launched it.
  const startedAfterUpdate = settings.get("restartedForUpdate") === true;
  settings.set("restartedForUpdate", false);
  const drafts = new Drafts(join(options.userDataDir, "meetings"));
  const platform = process.platform;
  const placement = (platform === "darwin" ? await measureMac() : null) ?? measureElectron();
  const offsetY = options.islandOffsetY ?? 0;
  const dashboardHolder: { host: DashboardHost | null } = { host: null };
  const loopback = createLoopback();

  /* ---------- who is on the call ---------- */

  const run = (file: string, args: string[], timeout: number) =>
    new Promise<string>((resolve, reject) => {
      execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        // A non-zero exit (`reg query` on a key that does not exist yet) is an empty answer; a program that is missing or
        // that timed out is a failure to report.
        if (error && typeof (error as { code?: unknown }).code !== "number") reject(error);
        else resolve(error ? "" : stdout);
      });
    });
  const pageReader = createPageReader((script) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], 10_000), () => Date.now());

  // The app's own icon, as the Swift island shows it: asked of the system once per app, kept as a small image.
  const icons = new Map<string, string | null>();
  const iconFor = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    if (icons.has(path)) return icons.get(path) ?? null;
    let dataUrl: string | null = null;
    // The system answers a missing file with a generic document icon, which would be the wrong picture.
    if (!existsSync(path)) return null;
    try {
      // "normal" is 32 px on both systems; "large" is unsupported on macOS and crashes Electron there.
      const image = await app.getFileIcon(path, { size: "normal" });
      if (!image.isEmpty()) dataUrl = image.resize({ width: 36, height: 36 }).toDataURL();
    } catch {
      // No icon for this app (a Store app has no executable path): the island draws its generic mark.
    }
    icons.set(path, dataUrl);
    return dataUrl;
  };

  const sourceOf = (caller: Caller | null, pages: BrowserPage[]): CallSource | null => callSourceForExe(caller?.appId) ?? CallSource.page(pages.map((p) => p.url));

  /* ---------- the island's brain ---------- */

  let reportedSize: { width: number; height: number } | null = null;
  const controller = new IslandController(
    {
      now: () => Date.now(),
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      emit: (channel, payload) => dashboardHolder.host?.emit(channel, payload),
      showMainWindow: () => dashboardHolder.host?.show(),
      onState: (state) => pushState(state),
      onLevels: (levels) => island.webContents.send("island:levels", levels),
      saveRecorderReady: (ready) => settings.set("recorderReady", ready),
      // A call was detected: name where it happens and send the CRM pages on screen, so the dashboard can name the contact.
      lookUpCallContact: (caller) => {
        if (platform !== "win32") return;
        void pageReader.read().then((pages) => {
          // A read that outlasts the click on Record still counts: the dashboard attaches it to the recording.
          if (!["call", "starting", "recording", "stopped"].includes(controller.state.mode.kind)) return;
          dashboard.emit("call:source", (sourceOf(caller, pages) ?? null)?.json ?? null);
          const urls = crmUrlsOf(pages);
          if (urls.length > 0) dashboard.emit("call:pages", { urls });
        });
      },
      // Recording without a detected call: name the app holding the mic, if any, without reading browsers needlessly.
      lookUpCallSource: (caller) => {
        if (platform !== "win32") return;
        const native = callSourceForExe(caller?.appId);
        if (native) return dashboard.emit("call:source", native.json);
        if (!caller) return;
        void pageReader.read().then((pages) => dashboard.emit("call:source", (CallSource.page(pages.map((p) => p.url)) ?? null)?.json ?? null));
      },
    },
    placement.geometry,
    { recorderReady: settings.get("recorderReady") === true, material: "opaque", reduceMotion: systemPreferences.getAnimationSettings().prefersReducedMotion },
  );

  /* ---------- the dashboard window ---------- */

  // The page records, then uploads the memo, then publishes the call's update, with gaps in between. It is given back only
  // when nothing is recording, no update is waiting, no unsent meeting is on disk, and it has been quiet for a while.
  const releaseGrace = options.releaseGraceMs ?? 30_000;
  let busyUntil = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const touch = () => {
    busyUntil = Date.now() + releaseGrace;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => dashboard.releaseIfIdle(), releaseGrace + 50);
  };
  // Once the app is quitting (a tray quit, an update restart) the dashboard window must close, not hide.
  let quitting = false;
  // The dashboard page does the recording and, after Stop, the upload: it must stay until the call is handed over.
  const recordingOrFinishing = () => ["recording", "stopped", "finishing"].includes(controller.state.mode.kind);
  const canDestroy = () =>
    quitting ||
    Date.now() >= busyUntil && !controller.isListening && !recordingOrFinishing() && controller.state.postCall === null && drafts.count() === 0;
  const dashboard = new DashboardHost({
    url: options.dashboardUrl,
    preload: join(here, "dashboard-preload.cjs"),
    icon: appIconPath,
    isTrustedHost: trustedHostsFor(options.dashboardUrl),
    isSignInHost: signInHostsFor(options.dashboardUrl),
    reportedPlatform: options.reportedPlatform ?? (platform === "win32" ? "win32" : "darwin"),
    trustFiles: options.trustFiles === true,
    canDestroy,
    log,
  });
  dashboardHolder.host = dashboard;

  /* ---------- the island window ---------- */

  const frameFor = (width: number, height: number) => ({
    x: Math.round(placement.originX + placement.midX - width / 2),
    y: Math.round(placement.originY + offsetY),
    width,
    height,
  });

  const targetSize = (state: IslandState) => {
    const open = state.expanded && state.mode.kind !== "starting";
    if (state.mode.kind === "postCall" && open && reportedSize) return reportedSize;
    return islandSize(state.geometry, state.mode.kind, open);
  };

  const initial = islandSize(placement.geometry, "idle", false);
  const island = new BrowserWindow({
    ...frameFor(initial.width, initial.height),
    frame: false,
    transparent: true,
    hasShadow: false,
    // macOS keeps ordinary windows under the menu bar; the island belongs up in it, around the camera, like the Mac app's.
    enableLargerThanScreen: true,
    resizable: false,
    movable: false,
    // Never takes focus from the call: a click acts on the first press without activating the app.
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    ...(platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // Above the menu bar and the taskbar, on every desktop, over full-screen windows.
  island.setAlwaysOnTop(true, "screen-saver");
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  /**
   * The window first covers both the old and the new shape, the shape animates inside it, then the window fits the new
   * shape: the frame and the page never animate against each other (the Swift island's approach).
   */
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  const fit = (target: { width: number; height: number }, force: boolean) => {
    const key = `${target.width}x${target.height}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const current = island.getBounds();
    const cover = { width: Math.max(current.width, target.width), height: Math.max(current.height, target.height) };
    island.setBounds(frameFor(cover.width, cover.height));
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => island.setBounds(frameFor(target.width, target.height)), 420);
  };

  let checkForUpdates: (() => void) | null = null;
  const dashboardHost = (() => {
    try {
      return new URL(options.dashboardUrl).hostname || "demo";
    } catch {
      return "demo";
    }
  })();
  const tray = createTray();
  // The microphone can be switched in the system's settings while the app runs: keep the tray's line current.
  const trayRefresh = tray ? setInterval(() => tray.setContextMenu(buildTrayMenu(controller.state)), 5000) : null;
  trayRefresh?.unref();
  if (platform === "darwin") {
    // Keeping the island over full-screen windows turns the app into one without a Dock icon; give it back.
    // The same icon as the Mac app: the mark inside a cream squircle (VocifyMark.squircle, rendered once).
    const dockIcon = nativeImage.createFromPath(join(here, "../assets/dock-icon.png"));
    // macOS puts the default icon back as the Dock entry reappears: set ours before and again just after.
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
    void app.dock?.show().then(() => {
      setTimeout(() => {
        if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
      }, 800);
    });
  }
  function pushState(state: IslandState): void {
    if (island.isDestroyed()) return;
    island.webContents.send("island:state", state);
    fit(targetSize(state), false);
    tray?.setContextMenu(buildTrayMenu(state));
    dashboard.releaseIfIdle();
  }

  await island.loadFile(join(here, "../../island/dist/index.html"));
  island.webContents.send("island:state", controller.state);
  island.showInactive();

  /* ---------- wiring ---------- */

  const shortcut = new ShortcutManager(
    platform === "win32" ? "win32" : "darwin",
    settings,
    {
      register: (accelerator, callback) => {
        try {
          return globalShortcut.register(accelerator, callback);
        } catch {
          return false;
        }
      },
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    () => controller.shortcutPressed(),
  );
  const bridge = createBridge({
    platform,
    reportedPlatform: options.reportedPlatform,
    testPermissions: options.testPermissions === true,
    controller,
    loopback,
    drafts,
    shortcut,
    emit: (channel, payload) => dashboard.emit(channel, payload),
    showMainWindow: () => dashboard.show(),
    microphoneAccess: () => systemPreferences.getMediaAccessStatus("microphone"),
    askMicrophone: platform === "darwin" ? () => systemPreferences.askForMediaAccess("microphone") : undefined,
    openExternal: (url) => void shell.openExternal(url),
    relaunch: () => {
      app.relaunch();
      app.quit();
    },
    fetch: async (url, init) => {
      const response = await net.fetch(url, init);
      return { status: response.status, text: () => response.text() };
    },
    log,
  });
  // Only the dashboard window may talk to the shell, and only through the bridge.
  ipcMain.handle("vocify", (event, op: unknown, args: unknown) => {
    if (!dashboard.isFrom(event.sender)) return null;
    dashboard.markReady();
    touch();
    return bridge(String(op), typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {});
  });
  ipcMain.on("vocify:state", (event, state: unknown) => {
    if (!dashboard.isFrom(event.sender)) return;
    dashboard.markReady();
    // Voice levels alone say nothing about the page's work; anything else does.
    if (typeof state === "object" && state !== null && Object.keys(state).some((key) => key !== "levels")) touch();
    void bridge("shell:state", { state });
  });
  ipcMain.on("island:act", (event, action: IslandAction) => {
    if (event.sender === island.webContents) controller.act(action);
  });
  ipcMain.on("island:resize", (event, size: { width: number; height: number }) => {
    if (event.sender !== island.webContents || !size || !(size.width > 0) || !(size.height > 0)) return;
    reportedSize = { width: Math.round(size.width), height: Math.round(size.height) };
    fit(targetSize(controller.state), true);
  });

  shortcut.activate();

  // Call detection: the microphone-use record Windows keeps (see windows/mic-use.ts). Polled once a second.
  let detection = Promise.resolve();
  const report = (detected: DetectedCaller | null) => {
    // In order, and with the app's icon ready before the island hears of the call.
    detection = detection.then(async () => {
      controller.callChanged(detected ? { name: detected.name, appId: detected.appId, icon: await iconFor(detected.path) } : null);
    });
  };
  const micWatcher =
    platform === "win32"
      ? new MicWatcher({
          read: () => run("reg.exe", ["query", MIC_CONSENT_KEY, "/s"], 5000),
          now: () => Date.now(),
          every: (ms, fn) => {
            const timer = setInterval(fn, ms);
            return () => clearInterval(timer);
          },
          ownExePath: process.execPath,
          onCaller: report,
          onError: (error) => log(`call detection read failed: ${String(error)}`),
        })
      : null;
  micWatcher?.start();
  app.on("will-quit", () => micWatcher?.halt());

  const reposition = () => {
    const next = platform === "darwin" ? placement : measureElectron();
    placement.geometry = next.geometry;
    placement.midX = next.midX;
    placement.originX = next.originX;
    placement.originY = next.originY;
    controller.setGeometry(next.geometry);
    fit(targetSize(controller.state), true);
  };
  screen.on("display-metrics-changed", reposition);
  screen.on("display-added", reposition);
  screen.on("display-removed", reposition);

  app.on("before-quit", (event) => {
    if (!controller.isListening) {
      quitting = true;
      return;
    }
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      message: "A meeting is still recording",
      detail: `What was transcribed so far stays on this ${platform === "darwin" ? "Mac" : "computer"} and is sent for review next time you open Vocify.`,
      buttons: ["Keep recording", "Quit"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) event.preventDefault();
    else quitting = true;
  });

  let controlsWindow: BrowserWindow | null = null;
  if (options.controls) {
    controlsWindow = new BrowserWindow({
      width: 360,
      height: 520,
      x: 40,
      y: 120,
      title: "Vocify demo: call detection",
      backgroundColor: "#16171a",
      webPreferences: { preload: join(here, "controls-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await controlsWindow.loadFile(join(here, "../demo/controls.html"));
    controlsWindow.on("closed", () => app.quit());
    ipcMain.on("demo:cmd", (event, name: string) => {
      if (event.sender !== controlsWindow?.webContents) return;
      if (name === "quit") return app.quit();
      if (name === "mic:zoom") return controller.callChanged({ name: "Zoom", appId: "zoom.exe" });
      if (name === "mic:chrome") return controller.callChanged({ name: "Google Chrome", appId: "chrome.exe" });
      if (name === "mic:none") return controller.callChanged(null);
      if (name === "signedout:toggle") return controller.applyShellState({ recorderReady: !controller.state.recorderReady });
      if (name === "dashboard:show") return dashboard.show();
    });
  }

  log(`app ${app.getVersion()}, dashboard ${options.dashboardUrl}`);
  log(`dashboard told the platform is ${options.reportedPlatform ?? platform}`);
  log(`started: island ${Math.round(initial.width)}x${initial.height}, notch ${Math.round(placement.geometry.notchWidth)}px, bar ${placement.geometry.barHeight}px`);
  return {
    controller,
    dashboard,
    island,
    islandBounds: () => island.getBounds(),
    detectCall: (caller) => controller.callChanged(caller),
    iconFor,
    permissions: () => bridge("permissions:status", {}),
    canInstallUpdate: () => !controller.isListening && !recordingOrFinishing() && controller.state.postCall === null,
    startedAfterUpdate,
    markUpdateRestart: () => settings.set("restartedForUpdate", true),
    onCheckForUpdates: (fn) => void (checkForUpdates = fn),
    log,
    quit: () => app.quit(),
  };

  /* ---------- tray ---------- */

  function createTray(): Tray | null {
    // The Mac menu bar takes a black "template" of the mark (the mic and its waves) that macOS tints for light and dark
    // bars; the Windows notification area takes the full-colour logo. Each file has an @2x twin for sharp high-DPI.
    const image = nativeImage.createFromPath(join(here, "../assets", platform === "darwin" ? "trayTemplate.png" : "tray.png"));
    if (image.isEmpty()) return null;
    const tray = new Tray(image);
    tray.setToolTip("Vocify");
    tray.on("click", () => dashboard.show());
    return tray;
  }

  function buildTrayMenu(state: IslandState): Menu {
    return Menu.buildFromTemplate(
      trayItems(state, `Vocify ${app.getVersion()} · ${dashboardHost}`, microphoneLabel(systemPreferences.getMediaAccessStatus("microphone"))).map((item) => {
        if (item.id === "separator") return { type: "separator" as const };
        const click = () => {
          if (item.id === "open") dashboard.show();
          else if (item.id === "record") controller.shortcutPressed();
          else if (item.id === "stop") controller.act({ name: "stop" });
          else if (item.id === "update") checkForUpdates?.();
          else if (item.id === "permissions") void shell.openExternal(microphoneSettingsUrl(platform));
          else app.quit();
        };
        return { label: item.label, enabled: item.enabled, click };
      }),
    );
  }
}

