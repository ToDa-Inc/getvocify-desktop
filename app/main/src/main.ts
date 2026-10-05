import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `--demo` runs the island against a stand-in dashboard page that speaks the real bridge, plus a window of buttons that
 * stand in for call detection, so every screen can be tried without signing in.
 * `VOCIFY_DASHBOARD_URL` points the real app at another dashboard (staging, a local build).
 */
const demo = process.argv.includes("--demo");
const DEFAULT_DASHBOARD = "https://app.getvocify.com";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let handle: Awaited<ReturnType<typeof startApp>> | null = null;
  app.on("second-instance", () => handle?.dashboard.show());
  // Closing every window must not quit: the island is always there.
  app.on("window-all-closed", () => {});
  // Electron emits `ready` only after an ES-module entry has finished loading, so no top-level await here.
  app
    .whenReady()
    .then(async () => {
      handle = await startApp({
        dashboardUrl: demo ? pathToFileURL(join(here, "../demo/fake-dashboard.html")).href : (process.env.VOCIFY_DASHBOARD_URL ?? DEFAULT_DASHBOARD),
        trustFiles: demo,
        userDataDir: demo ? join(app.getPath("userData"), "demo") : app.getPath("userData"),
        islandOffsetY: Number(process.env.ISLAND_OFFSET_Y ?? 0) || 0,
        controls: demo,
      });
    })
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
}
