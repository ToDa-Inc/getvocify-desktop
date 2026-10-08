import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, systemPreferences, Tray } from "electron";
import { existsSync } from "node:fs";
import { CallSource } from "../../core/callSource.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandSize, offerBriefLines, showsMeeting } from "../../island/src/geometry.ts";
import type { Geometry, IslandAction, IslandState } from "../../island/src/types.ts";
import { createBridge } from "./bridge.ts";
import { signInHostsFor, type ReportedPlatform } from "./config.ts";
import { IslandController, type Caller } from "./controller.ts";
import { DashboardHost } from "./dashboard.ts";
import { Drafts } from "./drafts.ts";
import { createLogger } from "./logger.ts";
import { JsonSettings } from "./settings.ts";
import { ShortcutManager } from "./shortcut.ts";
import { microphoneLabel, microphoneSettingsUrl } from "./permissions.ts";
import { trayItems } from "./tray-menu.ts";
import { callSourceForExe } from "./windows/call-sources.ts";
import { createCrmScreenWatcher } from "./crm-screen-watcher.ts";
import { runQuiet } from "./platform/exec.ts";
import { createPlatform } from "./platform/index.ts";
import { spawnMacHelper } from "./platform/mac/helper.ts";
import type { DetectedCaller } from "./platform/types.ts";
import { createPageReader, crmUrlsOf, encodePowerShell, type BrowserPage } from "./windows/browser-pages.ts";

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

/** The built-in screen's notch on a Mac, from vocify-mac-helper's `screen`. Everywhere else the screen is measured from Electron. */
function measureMac(helperPath: string): Promise<Placement | null> {
  return new Promise((resolve) => {
    const helper = spawnMacHelper(helperPath, "screen");
    let output = "";
    const timer = setTimeout(() => helper.kill(), 5000);
    helper.stdout.on("data", (chunk) => void (output += chunk.toString()));
    helper.on("exit", () => {
      clearTimeout(timer);
      try {
        const raw = JSON.parse(output) as { width?: number; height?: number; originX?: number; originY?: number; menuBar?: number; notchWidth?: number; barHeight?: number; midX?: number };
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
  // The Mac's native helper: shipped in the app's Resources, or built next to the sources in development.
  const macHelper = platform === "darwin" ? (app.isPackaged ? join(process.resourcesPath, "mac-helper", "vocify-mac-helper") : join(here, "../../native/mac-helper/dist/vocify-mac-helper")) : null;
  const macPanel = platform === "darwin" ? (app.isPackaged ? join(process.resourcesPath, "mac-panel", "mac_panel.node") : join(here, "../../native/mac-panel/dist/mac_panel.node")) : null;
  const placement = (macHelper ? await measureMac(macHelper) : null) ?? measureElectron();
  const offsetY = options.islandOffsetY ?? 0;
  const dashboardHolder: { host: DashboardHost | null } = { host: null };

  // The OS's own services (call audio, call detection, the CRM tab, permissions), built for this OS in one place.
  const os = createPlatform(platform, {
    systemPreferences,
    openExternal: (url) => void shell.openExternal(url),
    crmTabsAnswer: {
      get: () => {
        const stored = settings.get("crmTabs");
        return stored === "authorized" || stored === "denied" ? stored : undefined;
      },
      set: (value) => settings.set("crmTabs", value),
    },
    log,
    nativeHelperPath: macHelper,
    nativePanelPath: macPanel,
  });

  /* ---------- who is on the call ---------- */

  const pageReader = createPageReader((script) => runQuiet("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], 10_000), () => Date.now());

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
  let reportedKind: string | null = null;
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
      onLevels: (levels) => {
        if (!island.isDestroyed()) island.webContents.send("island:levels", levels);
      },
      saveRecorderReady: (ready) => settings.set("recorderReady", ready),
      openExternal: (url) => void shell.openExternal(url),
      // A call was detected: name where it happens and send the CRM pages on screen, so the dashboard can name the contact.
      lookUpCallContact: (caller) => {
        if (platform === "win32") {
          void pageReader.read().then((pages) => {
            // A read that outlasts the click on Record still counts: the dashboard attaches it to the recording.
            if (!["call", "starting", "recording", "stopped"].includes(controller.state.mode.kind)) return;
            dashboard.emit("call:source", (sourceOf(caller, pages) ?? null)?.json ?? null);
            const urls = crmUrlsOf(pages);
            if (urls.length > 0) dashboard.emit("call:pages", { urls });
          });
        } else if (platform === "darwin") {
          // On Mac, use the CRM screen reader to get the browser's CRM pages
          void os.crmScreenReader.front().then((app) => {
            if (!app) return;
            return os.crmScreenReader.read(app as string).then((urls) => {
              // A read that outlasts the click on Record still counts: the dashboard attaches it to the recording.
              if (!["call", "starting", "recording", "stopped"].includes(controller.state.mode.kind)) return;
              const pageSource = urls && urls.length > 0 ? CallSource.page(urls as string[]) : null;
              const appId = caller?.appId ?? undefined;
              const source = CallSource.app(appId) ?? pageSource;
              dashboard.emit("call:source", source?.json ?? null);
              if (urls && urls.length > 0) dashboard.emit("call:pages", { urls });
            });
          });
        }
      },
      // Recording without a detected call: name the app holding the mic, if any, without reading browsers needlessly.
      lookUpCallSource: (caller) => {
        if (platform === "win32") {
          const native = callSourceForExe(caller?.appId);
          if (native) return dashboard.emit("call:source", native.json);
          if (!caller) return;
          void pageReader.read().then((pages) => dashboard.emit("call:source", (CallSource.page(pages.map((p) => p.url)) ?? null)?.json ?? null));
        } else if (platform === "darwin") {
          // On Mac, use CallSource.app for the app name
          const appId = caller?.appId ?? undefined;
          const source = CallSource.app(appId);
          if (source) return dashboard.emit("call:source", source.json);
          if (!caller) return;
          // If no known app, try to read the CRM pages in the browser
          void os.crmScreenReader.front().then((app) => {
            if (!app) return;
            return os.crmScreenReader.read(app as string).then((urls) => {
              const pageSource = urls && urls.length > 0 ? CallSource.page(urls as string[]) : null;
              dashboard.emit("call:source", pageSource?.json ?? null);
            });
          });
        }
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
  // A call offer on show (or a call) needs the page that resolved it and that dials.
  const calling = () => controller.state.onScreen !== null || controller.state.dial !== null || ["dialConfirm", "dialing"].includes(controller.state.mode.kind);
  const canDestroy = () =>
    quitting ||
    Date.now() >= busyUntil && !controller.isListening && !recordingOrFinishing() && !calling() && controller.state.postCall === null && drafts.count() === 0;
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

  /* ---------- the CRM contact on screen (the island's call offer) ---------- */

  const crmScreen = createCrmScreenWatcher({
    front: () => os.crmScreenReader.front(),
    isBrowser: (app) => os.crmScreenReader.isBrowser(app),
    read: (app) => os.crmScreenReader.read(app),
    emit: (urls) => dashboard.emit("crm:screen", { urls }),
    every: (ms, fn) => {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    },
  });
  if (platform === "win32" || platform === "darwin") crmScreen.start();

  /* ---------- the island window ---------- */

  const frameFor = (width: number, height: number) => ({
    x: Math.round(placement.originX + placement.midX - width / 2),
    y: Math.round(placement.originY + offsetY),
    width,
    height,
  });

  const targetSize = (state: IslandState) => {
    const open = state.expanded && state.mode.kind !== "starting";
    // Sized by the page: the after-call card, and an offer or call carrying the brief. Only a size reported for this
    // same kind of island counts, so the card's height never leaks onto the next offer.
    const natural = state.mode.kind === "postCall" || offerBriefLines(state) > 0;
    if (open && natural && reportedSize && reportedKind === state.mode.kind) return reportedSize;
    return islandSize(state.geometry, state.mode.kind, open, undefined, offerBriefLines(state), showsMeeting(state));
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
    if (island.isDestroyed()) return;
    const current = island.getBounds();
    const cover = { width: Math.max(current.width, target.width), height: Math.max(current.height, target.height) };
    island.setBounds(frameFor(cover.width, cover.height));
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      if (!island.isDestroyed()) island.setBounds(frameFor(target.width, target.height));
    }, 420);
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
  /** While a call is recorded, who the meeting app shows speaking goes to the dashboard (it names the other side's lines). */
  let readingSpeakers = false;
  function followSpeakers(state: IslandState): void {
    const recording = state.mode.kind === "recording" || state.mode.kind === "stopped";
    if (recording && !readingSpeakers && os.speakers) {
      readingSpeakers = true;
      const zoom = controller.recordingAppId === "us.zoom.xos";
      const ask = zoom && settings.get("askedAccessibility") !== true;
      if (ask) settings.set("askedAccessibility", true);
      os.speakers.start({ askAccessibility: ask }, (names) => dashboard.emit("meeting:speakers", { names }));
    } else if (!recording && readingSpeakers) {
      readingSpeakers = false;
      os.speakers?.stop();
    }
  }

  function pushState(state: IslandState): void {
    followSpeakers(state);
    if (island.isDestroyed()) return;
    island.webContents.send("island:state", state);
    fit(targetSize(state), false);
    tray?.setContextMenu(buildTrayMenu(state));
    dashboard.releaseIfIdle();
  }

  await island.loadFile(join(here, "../../island/dist/index.html"));
  island.webContents.send("island:state", controller.state);
  // Before it is ever shown: a click on the island must never activate Vocify (that brings the dashboard forward).
  log(`island: ${os.island.prepare(island)}`);
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
    loopback: os.systemAudio,
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
    crmTabs: platform === "darwin" ? () => os.permissions.status().crmTabs : undefined,
    askCrmTabs: platform === "darwin" ? () => os.permissions.request("crmTabs") : undefined,
    systemAudioAccess: platform === "darwin" ? () => os.permissions.status().systemAudio : undefined,
    askSystemAudio: platform === "darwin" ? () => os.permissions.request("systemAudio") : undefined,
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
  // A message can still arrive from the island while the app quits and its window is already gone.
  const fromIsland = (sender: Electron.WebContents) => !island.isDestroyed() && sender === island.webContents;
  ipcMain.on("island:act", (event, action: IslandAction) => {
    if (fromIsland(event.sender)) controller.act(action);
  });
  /**
   * Typing in the card needs the keyboard, which the island otherwise never takes. Windows: the window becomes able to take
   * it while the pointer is over a field ("over"), so the rep's own click in the field focuses it the way any click does
   * (Windows refuses a window that pulls itself to the front), and gives it back when the typing is done ("release").
   * A card appearing, or a click elsewhere in it, never takes it. macOS: the window can take it while the card is shown,
   * so the click in a field itself focuses it.
   */
  ipcMain.handle("island:keyboard", (event, mode: string) => {
    if (!fromIsland(event.sender)) return false;
    const windows = platform === "win32";
    const giveBack = () => {
      island.setFocusable(false);
      if (island.isFocused()) island.blur();
    };
    if (mode === "available") {
      if (!windows) island.setFocusable(true);
    } else if (mode === "over") {
      // Electron's setFocusable on Windows also drops focus: never call it when nothing changes (it would blur a field).
      if (windows && !island.isFocusable()) island.setFocusable(true);
    } else if (mode === "now") {
      // Windows: the click in the field was input to this app, so it may bring its window to the front; a window created
      // "never activate" is not activated by the click itself. Each way is tried until the island has the keyboard.
      if (windows && !island.isFocused()) {
        if (!island.isFocusable()) island.setFocusable(true);
        island.focus();
        if (!island.isFocused()) {
          island.show();
          island.focus();
        }
        island.webContents.focus();
        log(`keyboard for typing in the island: ${island.isFocused() ? "taken" : "not given by Windows"}`);
      }
    } else if (mode === "release") {
      if (windows && !island.isFocused()) island.setFocusable(false);
      else if (windows) giveBack();
    } else {
      giveBack();
    }
    return true;
  });
  ipcMain.on("island:resize", (event, size: { width: number; height: number }) => {
    if (!fromIsland(event.sender) || !size || !(size.width > 0) || !(size.height > 0)) return;
    reportedSize = { width: Math.round(size.width), height: Math.round(size.height) };
    reportedKind = controller.state.mode.kind;
    fit(targetSize(controller.state), true);
  });

  shortcut.activate();

  // Call detection: the OS reports which app holds the microphone (none on a Mac until the native helper).
  let detection = Promise.resolve();
  const report = (detected: DetectedCaller | null) => {
    // In order, and with the app's icon ready before the island hears of the call.
    detection = detection.then(async () => {
      controller.callChanged(detected ? { name: detected.name, appId: detected.appId, icon: await iconFor(detected.path) } : null);
    });
  };
  os.callDetector?.start(report);
  app.on("will-quit", () => os.callDetector?.stop());

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

