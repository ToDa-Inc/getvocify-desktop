// How much memory a dashboard window adds to the island, and how much comes back when it is closed.
// Run: electron test/perf-dashboard.mjs   (loads the dashboard build that the Swift app bundles)
import { app, BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const island = join(here, "../island/dist/index.html");
const dashboard = process.argv.find((a) => a.startsWith("--dashboard="))?.slice(12) ?? "/Users/danizal/getvocify-desktop/apps/macos/build/web/index.html";
if (!existsSync(dashboard)) {
  console.log(`dashboard build not found at ${dashboard}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = async (label, settleMs) => {
  await sleep(settleMs);
  app.getAppMetrics();
  await sleep(2000);
  const metrics = app.getAppMetrics();
  const mb = metrics.reduce((sum, p) => sum + p.memory.workingSetSize / 1024, 0);
  const byType = metrics.map((p) => `${p.type} ${Math.round(p.memory.workingSetSize / 1024)}`).join(", ");
  const cpu = metrics.reduce((sum, p) => sum + p.cpu.percentCPUUsage, 0);
  console.log(`dash | ${label}: ${metrics.length} processes, ${Math.round(mb)} MB, cpu ${cpu.toFixed(1)}% | ${byType}`);
};

app.whenReady().then(async () => {
  const anchor = new BrowserWindow({ show: false, width: 100, height: 100 });
  await anchor.loadURL("data:text/html,<title>anchor</title>");
  await snapshot("anchor only (hidden, empty page)", 1500);

  const pill = new BrowserWindow({
    x: 80, y: 200, width: 460, height: 120, frame: false, transparent: true, hasShadow: false, focusable: false, show: false,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  await pill.loadFile(island);
  await pill.webContents.executeJavaScript(`new Promise(r=>{const t=()=>window.__setIslandState?r():setTimeout(t,10);t()})`);
  pill.showInactive();
  await snapshot("anchor + island", 2500);

  const board = new BrowserWindow({ x: 600, y: 100, width: 1200, height: 800, show: true, webPreferences: { contextIsolation: true } });
  await board.loadFile(dashboard).catch((e) => console.log("dashboard load:", e.code));
  await snapshot("anchor + island + dashboard window open", 5000);

  board.destroy();
  await snapshot("after closing the dashboard window", 5000);
  app.exit(0);
});
