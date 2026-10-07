// What the real shell costs: island only, island plus the real hosted dashboard (its sign-in page), and after the dashboard
// window is closed. Memory is the sum of all the app's processes (working set); CPU is averaged over 6 s.
// Run: node test/build-shell-test.mjs && electron test/weight.mjs [dashboard-url]
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv.find((a) => a.startsWith("http")) ?? "https://app.getvocify.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sample(label, settleMs) {
  await sleep(settleMs);
  app.getAppMetrics();
  let cpu = 0;
  let count = 0;
  const seconds = 6;
  for (let i = 0; i < seconds; i += 1) {
    await sleep(1000);
    cpu += app.getAppMetrics().reduce((sum, p) => sum + p.cpu.percentCPUUsage, 0);
  }
  const metrics = app.getAppMetrics();
  const mb = (type) => Math.round(metrics.filter((p) => p.type === type).reduce((sum, p) => sum + p.memory.workingSetSize / 1024, 0));
  const total = Math.round(metrics.reduce((sum, p) => sum + p.memory.workingSetSize / 1024, 0));
  count = metrics.length;
  console.log(`weight | ${label}: ${total} MB in ${count} processes (main ${mb("Browser")}, GPU ${mb("GPU")}, renderers ${mb("Tab")}, other ${mb("Utility")}) | cpu ${(cpu / seconds).toFixed(2)}%`);
}

app.whenReady().then(async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "vocify-weight-"));
  writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
  const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
  const handle = await startApp({ dashboardUrl: url, userDataDir, releaseGraceMs: 500, islandOffsetY: 200 });
  console.log(`weight | dashboard: ${url}; the harness itself adds no window`);
  await sample("island only (the dashboard window does not exist)", 4000);
  handle.dashboard.show();
  await sample("island + dashboard window open on its sign-in page", 8000);
  for (const win of BrowserWindow.getAllWindows()) if (win !== handle.island && win.isVisible()) win.close();
  await sample("dashboard closed again (given back)", 3000);
  handle.quit();
  app.exit(0);
});
app.on("window-all-closed", () => {});
