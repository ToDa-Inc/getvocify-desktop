import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { startApp } from "./app.ts";
import { resolveDashboardUrl, resolveReportedPlatform } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `--demo` runs the island against a stand-in dashboard page that speaks the real bridge, plus a window of buttons that
 * stand in for call detection, so every screen can be tried without signing in.
 * The dashboard address comes from `--dashboard=<url>`, `VOCIFY_DASHBOARD_URL` or `config.json` (see config.ts).
 */
const demo = process.argv.includes("--demo");
/** `--smoke-test`: start, check the island is on screen, quit with code 0 (1 if it is not). For installers and CI. */
const smoke = process.argv.includes("--smoke-test");
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
      let config: unknown = null;
      try {
        config = JSON.parse(readFileSync(join(app.getPath("userData"), "config.json"), "utf8"));
      } catch {
        // No config file: the defaults apply.
      }
      const dashboardUrl = demo
        ? pathToFileURL(join(here, "../demo/fake-dashboard.html")).href
        : resolveDashboardUrl({ argv: process.argv, env: process.env, config, fallback: DEFAULT_DASHBOARD });
      handle = await startApp({
        dashboardUrl,
        reportedPlatform: demo ? undefined : resolveReportedPlatform({ argv: process.argv, config, dashboardUrl, production: DEFAULT_DASHBOARD }),
        trustFiles: demo,
        userDataDir: demo ? join(app.getPath("userData"), "demo") : app.getPath("userData"),
        islandOffsetY: Number(process.env.ISLAND_OFFSET_Y ?? 0) || 0,
        controls: demo,
      });
      if (smoke) {
        setTimeout(() => app.exit(handle?.island.isVisible() ? 0 : 1), 4000);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
}
