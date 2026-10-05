// Measures what the island costs in CPU and memory, per Electron process, for one state at a time.
// Each variant opens a real always-on-top transparent window like the app does, warms up, then samples.
// Run: electron test/perf-island.mjs [dist-dir]   (default: ../island/dist)
import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, NOW } from "../island/fixtures/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.argv.find((a) => a.startsWith("--dist="))?.slice(7) ?? join(here, "../island/dist"));
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) ?? "run";
if (process.argv.includes("--nogpu")) app.disableHardwareAcceleration();
const WARMUP_MS = 2500;
const SAMPLE_MS = 8000;
const REPEATS = Number(process.argv.find((a) => a.startsWith("--repeat="))?.slice(9) ?? 1);

const fixture = (name) => fixtures.find((f) => f.name === name).state;
const live = () => ({ startedAt: Date.now() - 754_000, pausedMs: 0, pausedAt: null });

// Speaking: levels refreshed ten times a second, like the recorder pushes them.
// Fixtures default to reduced motion; the app does not, so animation is switched on here.
const speaking = (state) => ({ ...state, clock: live(), reduceMotion: false });

const variants = [
  { name: "idle-closed", state: () => ({ ...fixture("idle-closed"), reduceMotion: false }) },
  { name: "recording-closed, silent", state: () => speaking(fixture("recording-closed-hour")), silent: true },
  { name: "recording-closed, speaking", state: () => speaking(fixture("recording-closed")), speaking: true },
  { name: "recording-closed, speaking, reduce-motion", state: () => ({ ...speaking(fixture("recording-closed")), reduceMotion: true }), speaking: true },
  { name: "recording-closed, speaking, opaque window", state: () => speaking(fixture("recording-closed")), speaking: true, opaque: true },
  { name: "recording-open, speaking", state: () => speaking(fixture("recording-open-conversation")), speaking: true },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measure(variant) {
  const win = new BrowserWindow({
    x: 80, y: 200, width: 520, height: 420,
    frame: false, transparent: !variant.opaque, hasShadow: false, resizable: false, focusable: false, skipTaskbar: true,
    show: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadFile(join(dist, "index.html"));
  await win.webContents.executeJavaScript(`new Promise(r=>{const t=()=>window.__setIslandState?r():setTimeout(t,10);t()})`);
  await win.webContents.executeJavaScript(`(()=>{const o=window.__setIslandState; window.__setIslandState=(s)=>{window.__lastState=s;o(s)}})()`);
  const state = variant.state();
  win.showInactive();
  await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(state)}); true`);

  // Levels arrive from the recorder about ten times a second while someone speaks.
  const hasLevelsChannel = await win.webContents.executeJavaScript("typeof window.__setIslandLevels === 'function'");
  const feed = variant.speaking
    ? setInterval(() => {
        const level = 0.3 + Math.random() * 0.4;
        const levels = `{you:${level},them:0,side:"you",at:Date.now()}`;
        win.webContents.executeJavaScript(hasLevelsChannel ? `window.__setIslandLevels(${levels}); true` : `window.__setIslandState({...window.__lastState, levels:${levels}}); true`).catch(() => {});
      }, 100)
    : null;

  await sleep(WARMUP_MS);
  app.getAppMetrics(); // the first reading since the last call is the baseline
  const samples = [];
  const end = Date.now() + SAMPLE_MS;
  while (Date.now() < end) {
    await sleep(1000);
    samples.push(app.getAppMetrics());
  }
  if (feed) clearInterval(feed);
  win.destroy();

  const byType = {};
  for (const sample of samples) {
    for (const p of sample) {
      const t = p.type;
      byType[t] ??= { cpu: 0, mem: 0, n: 0 };
      byType[t].cpu += p.cpu.percentCPUUsage / samples.length;
      byType[t].mem = Math.max(byType[t].mem, p.memory.workingSetSize / 1024);
    }
  }
  const total = Object.values(byType).reduce((sum, t) => sum + t.cpu, 0);
  return { name: variant.name, totalCpu: Number(total.toFixed(1)), byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, `${v.cpu.toFixed(1)}% cpu, ${v.mem.toFixed(0)} MB`])) };
}

app.whenReady().then(async () => {
  const anchor = new BrowserWindow({ show: false, width: 100, height: 100 });
  await anchor.loadURL("data:text/html,<title>anchor</title>");
  const results = [];
  for (const variant of variants) {
    const runs = [];
    for (let i = 0; i < REPEATS; i += 1) runs.push(await measure(variant));
    const totals = runs.map((r) => r.totalCpu);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    results.push({ name: variant.name, mean: Number(mean.toFixed(2)), min: Math.min(...totals), max: Math.max(...totals), runs });
    console.log(`${label} | ${variant.name}: mean ${mean.toFixed(2)}% (min ${Math.min(...totals)}, max ${Math.max(...totals)}) | memory ${Object.values(runs.at(-1).byType).map((v) => v.split(", ")[1]).join(" + ")}`);
  }
  writeFileSync(join(here, `out/perf-${label}.json`), JSON.stringify(results, null, 2));
  app.exit(0);
});
