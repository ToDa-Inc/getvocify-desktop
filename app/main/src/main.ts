import { app, BrowserWindow, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { islandSize } from "../../island/src/geometry.ts";
import type { Geometry, IslandAction, IslandState } from "../../island/src/types.ts";
import { DemoController } from "./demo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const islandPage = join(here, "../../island/dist/index.html");

type Placement = { geometry: Geometry; midX: number; originX: number; originY: number };

/** The notch comes from a Swift script for now; the Mac helper's `geometry.get` replaces it. Other screens use the menu bar. */
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

function measureFallback(): Placement {
  const display = screen.getPrimaryDisplay();
  const menuBar = display.workArea.y - display.bounds.y;
  return {
    geometry: { notchWidth: 0, barHeight: Math.max(menuBar, 30), screenHeight: display.bounds.height },
    midX: display.bounds.width / 2,
    originX: display.bounds.x,
    originY: display.bounds.y,
  };
}

let island: BrowserWindow | null = null;
let controls: BrowserWindow | null = null;

/** `ISLAND_OFFSET_Y` drops the island below the top edge, to run beside the Swift island instead of on top of it. */
const offsetY = Number(process.env.ISLAND_OFFSET_Y ?? 0) || 0;

function frameFor(placement: Placement, width: number, height: number) {
  return { x: Math.round(placement.originX + placement.midX - width / 2), y: Math.round(placement.originY + offsetY), width, height };
}

async function start(): Promise<void> {
  const placement = (process.platform === "darwin" ? await measureMac() : null) ?? measureFallback();
  const reduceMotion = false;
  const demo = new DemoController(placement.geometry, "opaque", reduceMotion, (line) => controls?.webContents.send("demo:log", line));

  const initial = islandSize(placement.geometry, "idle", false);
  island = new BrowserWindow({
    ...frameFor(placement, initial.width, initial.height),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    // Window-level vibrancy cannot follow the island's rounded shape, and the window is larger than the shape while it
    // animates, so the glass is the denser "opaque" material here (the same one Windows gets).
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // Above the menu bar, so the island can sit beside the camera housing, and on every Space.
  island.setAlwaysOnTop(true, "screen-saver");
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await island.loadFile(islandPage);

  /**
   * The window first covers both the old and new shape, the shape animates inside it, then the window fits the new
   * shape: the frame and the page never animate against each other (same approach as the Swift island).
   */
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  const push = (state: IslandState) => {
    island?.webContents.send("island:state", state);
    const open = state.expanded && state.mode.kind !== "starting";
    const target = islandSize(state.geometry, state.mode.kind, open);
    const key = `${target.width}x${target.height}`;
    if (key === lastKey || !island) return;
    lastKey = key;
    const current = island.getBounds();
    const cover = frameFor(placement, Math.max(current.width, target.width), Math.max(current.height, target.height));
    island.setBounds(cover);
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => island?.setBounds(frameFor(placement, target.width, target.height)), 420);
  };
  demo.subscribe(push);
  island.webContents.once("did-finish-load", () => island?.webContents.send("island:state", demo.state));
  island.webContents.send("island:state", demo.state);
  island.showInactive();

  ipcMain.on("island:act", (_event, action: IslandAction) => demo.act(action));
  ipcMain.on("demo:cmd", (_event, name: string) => {
    if (name === "quit") return app.quit();
    demo.command(name);
  });

  controls = new BrowserWindow({
    width: 360,
    height: 640,
    x: 40,
    y: 120,
    title: "Vocify island demo",
    backgroundColor: "#16171a",
    webPreferences: { preload: join(here, "controls-preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  await controls.loadFile(join(here, "../demo/controls.html"));
  controls.on("closed", () => app.quit());
  controls.webContents.send("demo:log", `Island placed at the top of the screen (notch ${Math.round(placement.geometry.notchWidth)} px, bar ${placement.geometry.barHeight} px).`);
}

// Electron emits `ready` only after an ES-module entry has finished loading, so no top-level await here.
app.whenReady().then(start).catch((error) => {
  console.error(error);
  app.exit(1);
});
app.on("window-all-closed", () => app.quit());
