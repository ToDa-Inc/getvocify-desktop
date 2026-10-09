// Plays a call as it streams (island/preview/live.js) in a real window and reports what moved under the reader:
// bubbles that shrank while their words arrived, dots left on a line of their own, how far the view jumped at once,
// and whether it ever let go of the latest line on its own.
// Run: node island/build.mjs --preview && electron test/motion-island.mjs [--script=rally] [--dist=dir] [--label=name]
import { app, BrowserWindow } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv.find((a) => a.startsWith("--dist="))?.slice(7) ?? join(here, "../island/dist"));
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "island";
const script = process.argv.find((a) => a.startsWith("--script="))?.slice(9);
const material = process.argv.find((a) => a.startsWith("--material="))?.slice(11);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 80, y: 120, width: 520, height: 440,
    frame: false, transparent: true, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true,
    show: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadFile(join(dist, "live.html"), { query: { speed: "2", ...(script ? { script } : {}), ...(material ? { material } : {}) } });
  win.showInactive();
  const read = () => win.webContents.executeJavaScript("JSON.stringify(window.__LIVE ?? {})").then(JSON.parse);
  const until = Date.now() + 120_000;
  let live = await read();
  while (!live.done && Date.now() < until) {
    await sleep(500);
    live = await read();
  }
  console.log(`${label}: ${JSON.stringify(live)}`);
  const failed = !live.done || live.shrinks > 0 || live.dotsAlone > 0 || live.unfollowed > 0 || live.stillAnimating > 0;
  app.exit(process.argv.includes("--report") ? 0 : failed ? 1 : 0);
});
