import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, screen, shell, systemPreferences, Tray } from "electron";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandSize } from "../../island/src/geometry.ts";
import type { Geometry, IslandAction, IslandState } from "../../island/src/types.ts";
import { createBridge } from "./bridge.ts";
import { IslandController, type Caller } from "./controller.ts";
import { DashboardHost } from "./dashboard.ts";
import { Drafts } from "./drafts.ts";
import { createLoopback } from "./loopback/loopback.ts";
import { createLogger } from "./logger.ts";
import { JsonSettings } from "./settings.ts";
import { ShortcutManager } from "./shortcut.ts";
import { trayItems } from "./tray-menu.ts";

const here = dirname(fileURLToPath(import.meta.url));

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

const isTrustedHost = (host: string): boolean => {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "getvocify.com" || h.endsWith(".getvocify.com");
};

export async function startApp(options: AppOptions): Promise<AppHandle> {
  const log = createLogger(join(options.userDataDir, "logs", "vocify.log"));
  const settings = new JsonSettings(join(options.userDataDir, "settings.json"));
  const drafts = new Drafts(join(options.userDataDir, "meetings"));
  const platform = process.platform;
  const placement = (platform === "darwin" ? await measureMac() : null) ?? measureElectron();
  const offsetY = options.islandOffsetY ?? 0;
  const dashboardHolder: { host: DashboardHost | null } = { host: null };
  const loopback = createLoopback();

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
      // The platform helper will read the CRM page on screen and name the call's app; until it exists the dashboard
      // learns about neither, which leaves the island showing the app name only.
      lookUpCallContact: () => {},
      lookUpCallSource: () => {},
    },
    placement.geometry,
    { recorderReady: settings.get("recorderReady") === true, material: "opaque", reduceMotion: false },
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
  const canDestroy = () =>
    Date.now() >= busyUntil && !controller.isListening && controller.state.mode.kind !== "recording" && controller.state.mode.kind !== "stopped" && controller.state.postCall === null && drafts.count() === 0;
  const dashboard = new DashboardHost({
    url: options.dashboardUrl,
    preload: join(here, "dashboard-preload.cjs"),
    isTrustedHost,
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

  const tray = createTray();
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
    controller,
    loopback,
    drafts,
    shortcut,
    emit: (channel, payload) => dashboard.emit(channel, payload),
    showMainWindow: () => dashboard.show(),
    microphoneAccess: () => systemPreferences.getMediaAccessStatus("microphone"),
    openExternal: (url) => void shell.openExternal(url),
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
    if (!controller.isListening) return;
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      message: "A meeting is still recording",
      detail: `What was transcribed so far stays on this ${platform === "darwin" ? "Mac" : "computer"} and is sent for review next time you open Vocify.`,
      buttons: ["Keep recording", "Quit"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 0) event.preventDefault();
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

  log(`started: island ${Math.round(initial.width)}x${initial.height}, notch ${Math.round(placement.geometry.notchWidth)}px, bar ${placement.geometry.barHeight}px`);
  return {
    controller,
    dashboard,
    island,
    islandBounds: () => island.getBounds(),
    detectCall: (caller) => controller.callChanged(caller),
    quit: () => app.quit(),
  };

  /* ---------- tray ---------- */

  function createTray(): Tray | null {
    const iconPath = join(here, "../../island/dist/icon.png");
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return null;
    const tray = new Tray(image.resize({ width: 16, height: 16 }));
    tray.setToolTip("Vocify");
    tray.on("click", () => dashboard.show());
    return tray;
  }

  function buildTrayMenu(state: IslandState): Menu {
    return Menu.buildFromTemplate(
      trayItems(state).map((item) => {
        if (item.id === "separator") return { type: "separator" as const };
        const click = () => {
          if (item.id === "open") dashboard.show();
          else if (item.id === "record") controller.shortcutPressed();
          else if (item.id === "stop") controller.act({ name: "stop" });
          else app.quit();
        };
        return { label: item.label, enabled: item.enabled, click };
      }),
    );
  }
}

